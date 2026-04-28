import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { canRequestSubscriptionTier } from "@/lib/subscription-tier";
import type { SubscriptionRequestRow } from "@/lib/types";
import type { Tier } from "@/lib/tiers";

export const runtime = "nodejs";

const schema = z.object({
  tier: z.enum(["starter", "creator", "pro"]),
  months: z.coerce.number().int().min(1).max(24),
  paymentNote: z.string().trim().min(8).max(4000),
  bankReference: z.string().trim().max(500).optional(),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("subscription_requests")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data ?? []) as SubscriptionRequestRow[]);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload tidak valid", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("tier, plan_expires_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const currentTier: Tier =
    profile?.tier === "starter" ||
    profile?.tier === "creator" ||
    profile?.tier === "pro" ||
    profile?.tier === "free"
      ? profile.tier
      : "free";

  const gate = canRequestSubscriptionTier(
    currentTier,
    parsed.data.tier,
    profile?.plan_expires_at ?? null,
  );
  if (!gate.ok) {
    return NextResponse.json({ error: gate.reason ?? "Permintaan tidak diizinkan" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("subscription_requests")
    .insert({
      user_id: user.id,
      requested_tier: parsed.data.tier,
      months: parsed.data.months,
      payment_note: parsed.data.paymentNote,
      bank_reference: parsed.data.bankReference || null,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    return NextResponse.json(
      { error: error?.message ?? "Gagal menyimpan permintaan upgrade" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: data.id as string });
}
