import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

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
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ count: userCount }, { count: jobs24 }, { count: jobs7 }, { data: lastSnap }, { data: poolRows }] =
    await Promise.all([
      admin.from("profiles").select("user_id", { count: "exact", head: true }),
      admin.from("jobs").select("id", { count: "exact", head: true }).gte("created_at", since24h),
      admin.from("jobs").select("id", { count: "exact", head: true }).gte("created_at", since7d),
      admin
        .from("platform_storage_snapshots")
        .select("taken_at,total_bytes,storage_cost_usd_est,worker_disk_bytes_est")
        .order("taken_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin.from("operator_llm_api_key_pool").select("provider,enabled,health_status"),
    ]);

  const poolByProvider: Record<string, { enabled: number; healthy: number; other: number }> = {};
  for (const r of poolRows ?? []) {
    const p = String(r.provider);
    if (!poolByProvider[p]) poolByProvider[p] = { enabled: 0, healthy: 0, other: 0 };
    if (!r.enabled) continue;
    poolByProvider[p].enabled += 1;
    if (String(r.health_status) === "healthy") poolByProvider[p].healthy += 1;
    else poolByProvider[p].other += 1;
  }

  return NextResponse.json({
    users_total: userCount ?? 0,
    jobs_created_24h: jobs24 ?? 0,
    jobs_created_7d: jobs7 ?? 0,
    storage_latest: lastSnap ?? null,
    llm_pool: poolByProvider,
    note: "Agregat saja — tanpa identitas per job atau konten video.",
  });
}
