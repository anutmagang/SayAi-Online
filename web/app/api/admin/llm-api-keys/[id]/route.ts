import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const tierScopeEnum = z.enum(["free", "starter", "creator", "pro"]);

const patchSchema = z.object({
  label: z.string().max(120).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  enabled: z.boolean().optional(),
  /** null = semua tier */
  appliesToTier: tierScopeEnum.nullable().optional(),
  /** Admin: paksa reset cooldown / error agar key langsung dicoba lagi */
  clearRuntimeCooldown: z.boolean().optional(),
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

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if ("error" in gate) return gate.error;

  const id = params.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });
  }

  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.label !== undefined) patch.label = parsed.data.label.trim();
  if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
  if (parsed.data.appliesToTier !== undefined) {
    patch.applies_to_tier = parsed.data.appliesToTier;
  }
  if (parsed.data.clearRuntimeCooldown === true) {
    patch.health_status = "healthy";
    patch.cooldown_until = null;
    patch.next_probe_at = null;
    patch.last_error = null;
    patch.probe_fail_streak = 0;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Tidak ada field untuk diubah" }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("operator_llm_api_key_pool")
    .update(patch)
    .eq("id", id)
    .select(
      "id, provider, label, key_hint, sort_order, enabled, applies_to_tier, created_at, health_status, cooldown_until, next_probe_at, last_error, probe_fail_streak, last_success_at",
    )
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if ("error" in gate) return gate.error;

  const id = params.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { error } = await admin.from("operator_llm_api_key_pool").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
