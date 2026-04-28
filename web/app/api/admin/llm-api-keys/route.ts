import { NextResponse } from "next/server";
import { z } from "zod";
import { encryptApiKeyPlaintext, readMasterSecretForPool } from "@/lib/api-key-pool-crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const providerEnum = z.enum(["groq", "gemini", "openai", "openrouter", "anthropic"]);
const tierScopeEnum = z.enum(["free", "starter", "creator", "pro"]);

const postSchema = z.object({
  provider: providerEnum,
  label: z.string().max(120).optional().default(""),
  plaintextKey: z.string().min(8).max(4096),
  sortOrder: z.number().int().min(0).max(9999).optional().default(0),
  /** null / omit = semua tier */
  appliesToTier: tierScopeEnum.nullable().optional(),
});

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if ("error" in gate) return gate.error;

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("operator_llm_api_key_pool")
    .select(
      "id, provider, label, key_hint, sort_order, enabled, applies_to_tier, created_at, health_status, cooldown_until, next_probe_at, last_error, probe_fail_streak, last_success_at",
    )
    .order("provider", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if ("error" in gate) return gate.error;

  const masterRes = readMasterSecretForPool();
  if (!masterRes.ok) {
    return NextResponse.json({ error: masterRes.error }, { status: 400 });
  }
  const master = masterRes.secret;

  const json = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload tidak valid", details: parsed.error.flatten() }, { status: 400 });
  }

  const { provider, label, plaintextKey, sortOrder, appliesToTier } = parsed.data;
  const tail = plaintextKey.trim().slice(-4);
  const keyHint = tail ? `…${tail}` : "";

  let ciphertext: string;
  try {
    ciphertext = encryptApiKeyPlaintext(master, plaintextKey.trim());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("operator_llm_api_key_pool")
    .insert({
      provider,
      label: label.trim(),
      key_hint: keyHint,
      secret_ciphertext: ciphertext,
      sort_order: sortOrder,
      enabled: true,
      applies_to_tier: appliesToTier ?? null,
    })
    .select(
      "id, provider, label, key_hint, sort_order, enabled, applies_to_tier, created_at, health_status, cooldown_until, next_probe_at, last_error, probe_fail_streak, last_success_at",
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
