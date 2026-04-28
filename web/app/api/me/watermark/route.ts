import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const positionEnum = z.enum([
  "top_left",
  "top_right",
  "bottom_left",
  "bottom_right",
  "center",
]);

const schema = z.object({
  enabled: z.boolean(),
  customText: z.string().max(120).optional().default(""),
  position: positionEnum.optional().default("bottom_right"),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload tidak valid", details: parsed.error.flatten() }, { status: 400 });
  }

  const { enabled, customText, position } = parsed.data;

  const { error } = await supabase.rpc("set_watermark_preferences", {
    p_enabled: enabled,
    p_custom_text: customText.trim() || null,
    p_position: position,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("WATERMARK_PREFS_PAID_ONLY")) {
      return NextResponse.json(
        { error: "Watermark kustom hanya untuk paket Starter ke atas." },
        { status: 403 },
      );
    }
    if (msg.includes("WATERMARK_TEXT_REQUIRED_WHEN_ENABLED")) {
      return NextResponse.json(
        { error: "Isi teks watermark minimal satu karakter saat opsi aktif." },
        { status: 400 },
      );
    }
    if (msg.includes("INVALID_WATERMARK_POSITION")) {
      return NextResponse.json({ error: "Posisi watermark tidak valid." }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
