import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bodySchema = z.object({
  approve: z.boolean(),
  adminNote: z.string().trim().max(2000).optional().nullable(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { id } = params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }

  const { error } = await supabase.rpc("admin_review_topup", {
    p_request_id: id,
    p_approve: parsed.data.approve,
    p_admin_note: parsed.data.adminNote ?? null,
  });

  if (error) {
    const m = error.message ?? "";
    if (m.includes("FORBIDDEN")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (m.includes("NOT_FOUND")) {
      return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
    }
    if (m.includes("ALREADY_REVIEWED")) {
      return NextResponse.json({ error: "Sudah diproses" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
