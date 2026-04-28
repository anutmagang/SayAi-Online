import { randomBytes } from "crypto";
import path from "path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { maxUploadBytes, safeVideoExtension, sanitizeBasename } from "@/lib/upload";

export const runtime = "nodejs";

const schema = z.object({
  filename: z.string().min(1).max(240),
  contentType: z.string().min(1).max(120),
  size: z.number().int().min(1),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload tidak valid", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const maxB = maxUploadBytes();
  if (parsed.data.size > maxB) {
    return NextResponse.json(
      {
        error: `Ukuran file ${Math.floor(parsed.data.size / 1024 / 1024)}MB > batas ${Math.floor(
          maxB / 1024 / 1024,
        )}MB`,
      },
      { status: 413 },
    );
  }

  const ext = safeVideoExtension(parsed.data.filename, parsed.data.contentType);
  if (!ext) {
    return NextResponse.json(
      { error: "Format tidak didukung (gunakan mp4/webm/mov/mkv/mp3/m4a/wav)" },
      { status: 400 },
    );
  }

  const slug = randomBytes(8).toString("hex");
  const safeBase = sanitizeBasename(path.basename(parsed.data.filename, path.extname(parsed.data.filename)));
  const objectPath = `${user.id}/${slug}-${safeBase}${ext}`;

  const admin = createServiceRoleClient();
  const { data, error } = await admin.storage
    .from("sources")
    .createSignedUploadUrl(objectPath);

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Gagal membuat signed upload URL" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    path: objectPath,
    signedUrl: data.signedUrl,
    token: data.token,
  });
}
