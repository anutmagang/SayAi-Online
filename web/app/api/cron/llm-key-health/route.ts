import { NextResponse } from "next/server";
import {
  API_KEY_POOL_MASTER_SECRET_MIN_LEN,
  decryptApiKeyPayload,
} from "@/lib/api-key-pool-crypto";
import { verifyCronAuth } from "@/lib/llm-catalog-refresh";
import { probeProviderKey } from "@/lib/llm-key-probe";
import { sendOperatorAlertEmail } from "@/lib/operator-email";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const PROVIDERS_ALERT = ["groq", "gemini", "openai", "openrouter", "anthropic"] as const;

const ALERT_DEBOUNCE_MS = 4 * 60 * 60 * 1000;

function backoffSecForStreak(streak: number): number {
  const base = 120;
  const capped = Math.min(streak, 8);
  return Math.min(7200, base * 2 ** capped);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json({ error: "CRON_SECRET tidak di-set." }, { status: 503 });
  }
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const master = process.env.API_KEY_POOL_MASTER_SECRET?.trim();
  if (!master || master.length < API_KEY_POOL_MASTER_SECRET_MIN_LEN) {
    return NextResponse.json({ error: "API_KEY_POOL_MASTER_SECRET kurang panjang." }, { status: 503 });
  }

  const admin = createServiceRoleClient();
  const nowIso = new Date().toISOString();
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

  await admin.from("llm_key_limit_events").delete().lt("created_at", tenDaysAgo);

  const { data: rows, error: fetchErr } = await admin
    .from("operator_llm_api_key_pool")
    .select(
      "id,provider,secret_ciphertext,enabled,health_status,cooldown_until,next_probe_at,probe_fail_streak",
    )
    .eq("enabled", true);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const now = Date.now();
  let probed = 0;
  let recovered = 0;

  for (const row of rows ?? []) {
    const cd = row.cooldown_until ? new Date(row.cooldown_until as string).getTime() : NaN;
    const np = row.next_probe_at ? new Date(row.next_probe_at as string).getTime() : NaN;
    const cooldownPassed = !row.cooldown_until || Number.isNaN(cd) || cd <= now;
    const probeDue = !row.next_probe_at || Number.isNaN(np) || np <= now;

    const hs = String(row.health_status ?? "unknown");
    if (hs === "healthy" && cooldownPassed) continue;
    if (!cooldownPassed) continue;
    if (!probeDue) continue;
    if (hs === "unknown") continue;

    const blob = (row.secret_ciphertext as string | null)?.trim();
    if (!blob) continue;
    let plain: string;
    try {
      plain = decryptApiKeyPayload(master, blob).trim();
    } catch {
      continue;
    }
    if (!plain) continue;

    probed += 1;
    const provider = String(row.provider);
    const pr = await probeProviderKey(provider, plain);

    if (pr.ok) {
      recovered += 1;
      await admin
        .from("operator_llm_api_key_pool")
        .update({
          health_status: "healthy",
          cooldown_until: null,
          next_probe_at: null,
          last_error: null,
          probe_fail_streak: 0,
          last_success_at: nowIso,
        })
        .eq("id", row.id as string);

      await admin.from("llm_key_limit_events").insert({
        pool_id: row.id as string,
        provider,
        event_kind: "probe_ok",
        message: `http ${pr.status ?? "ok"}`,
      });
    } else {
      const streak = Number(row.probe_fail_streak ?? 0) + 1;
      const sec = backoffSecForStreak(streak);
      const until = new Date(Date.now() + sec * 1000).toISOString();
      const detail = (pr.detail ?? "").slice(0, 400);
      await admin
        .from("operator_llm_api_key_pool")
        .update({
          health_status: "error",
          cooldown_until: until,
          next_probe_at: until,
          last_error: detail || `probe_http_${pr.status ?? "?"}`,
          probe_fail_streak: streak,
        })
        .eq("id", row.id as string);

      await admin.from("llm_key_limit_events").insert({
        pool_id: row.id as string,
        provider,
        event_kind: "probe_fail",
        message: detail,
      });
    }
  }

  const { data: poolSnap } = await admin.from("operator_llm_api_key_pool").select("provider,enabled,health_status,cooldown_until").eq("enabled", true);

  const alerts: string[] = [];
  for (const p of PROVIDERS_ALERT) {
    const subset = (poolSnap ?? []).filter((r) => r.provider === p);
    if (subset.length === 0) continue;
    const allBlocked =
      subset.length > 0 && !subset.some((r) => String(r.health_status ?? "") === "healthy");
    if (!allBlocked) continue;

    const { data: sentRow } = await admin
      .from("operator_provider_alert_sent")
      .select("last_sent_at")
      .eq("provider", p)
      .maybeSingle();

    const last = sentRow?.last_sent_at ? new Date(sentRow.last_sent_at as string).getTime() : 0;
    if (last && now - last < ALERT_DEBOUNCE_MS) continue;

    const okMail = await sendOperatorAlertEmail(
      `[Clipper] Semua key ${p} sedang cooldown / error`,
      `Cron llm-key-health mendeteksi tidak ada key ${p} yang siap dipakai (semua baris aktif masih dalam cooldown atau error). Periksa pool admin.`,
    );
    if (okMail) {
      await admin.from("operator_provider_alert_sent").upsert(
        { provider: p, last_sent_at: nowIso },
        { onConflict: "provider" },
      );
      alerts.push(p);
    }
  }

  return NextResponse.json({ ok: true, probed, recovered, alerts });
}
