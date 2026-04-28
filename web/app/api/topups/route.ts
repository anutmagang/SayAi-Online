import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { TopupRequestRow } from "@/lib/types";

export const runtime = "nodejs";

const createSchema = z.object({
  creditsRequested: z.coerce.number().int().min(1).max(100_000),
  paymentNote: z.string().trim().min(8).max(4000),
  bankReference: z.string().trim().max(500).optional(),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("topup_requests")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json((data ?? []) as TopupRequestRow[]);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload tidak valid", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("topup_requests")
    .insert({
      user_id: user.id,
      credits_requested: parsed.data.creditsRequested,
      payment_note: parsed.data.paymentNote,
      bank_reference: parsed.data.bankReference || null,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    return NextResponse.json(
      { error: error?.message ?? "Gagal menyimpan permintaan top-up" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: data.id as string });
}
