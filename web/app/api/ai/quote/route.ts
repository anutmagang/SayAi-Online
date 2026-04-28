import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";


export const runtime = "nodejs";

const quoteSchema = z.object({
  kind: z.enum(["image_gen", "video_gen"]),
  durationSec: z.coerce.number().int().min(2).max(12).optional(),
  model: z.string().max(120).optional(),
  aspectRatio: z.enum(["1:1", "9:16", "16:9", "4:3", "3:4"]).optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = quoteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload quote tidak valid" }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("tier")
    .eq("user_id", user.id)
    .maybeSingle();

  const tier =
    profile?.tier === "starter" ||
    profile?.tier === "creator" ||
    profile?.tier === "pro" ||
    profile?.tier === "free"
      ? profile.tier
      : "free";

  const { data: quoteRows, error: quoteErr } = await supabase.rpc("ai_quote_credits", {
    p_job_type: parsed.data.kind,
    p_model: parsed.data.model?.trim() || null,
    p_aspect_ratio: parsed.data.aspectRatio ?? "1:1",
    p_duration_sec: parsed.data.kind === "video_gen" ? parsed.data.durationSec ?? 4 : null,
    p_tier: tier,
  });

  if (quoteErr) {
    return NextResponse.json({ error: quoteErr.message ?? "Gagal hitung quote" }, { status: 500 });
  }

  const credits = typeof quoteRows === "number" ? quoteRows : Number(quoteRows ?? 0);
  return NextResponse.json({
    credits,
    tier,
  });
}

