import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const OBJECT_NAME = "youtube-cookies.txt";

function looksLikeNetscapeCookies(buf: Buffer): boolean {
  const head = buf.subarray(0, Math.min(buf.length, 8000)).toString("utf-8").toLowerCase();
  if (head.trimStart().startsWith("{") || head.trimStart().startsWith("[")) {
    return false;
  }
  if (head.includes("netscape") && head.includes("cookie")) {
    return true;
  }
  const lines = head.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  return lines.some((l) => l.split("\t").length >= 7);
}

/** Panggil setelah client PUT ke signed URL — verifikasi isi lalu set youtube_cookies_uploaded_at. */
export async function POST() {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = `${user.id}/${OBJECT_NAME}`;
  const admin = createServiceRoleClient();
  const { data, error } = await admin.storage.from("youtube_cookies").download(key);
  if (error || !data) {
    return NextResponse.json(
      { error: "File belum ada di Storage. Unggah ulang." },
      { status: 400 },
    );
  }
  const buf = Buffer.from(await data.arrayBuffer());
  if (buf.length < 80) {
    await admin.storage.from("youtube_cookies").remove([key]);
    return NextResponse.json({ error: "File terlalu kecil — pastikan cookies.txt lengkap." }, { status: 400 });
  }
  if (buf.length > 400 * 1024) {
    await admin.storage.from("youtube_cookies").remove([key]);
    return NextResponse.json({ error: "File terlalu besar (maks 400 KB)." }, { status: 400 });
  }
  if (!looksLikeNetscapeCookies(buf)) {
    await admin.storage.from("youtube_cookies").remove([key]);
    return NextResponse.json(
      {
        error:
          "Bukan format Netscape cookies.txt (biasanya export JSON). Ekspor ulang dari ekstensi yang mendukung Netscape.",
      },
      { status: 400 },
    );
  }

  const { error: upErr } = await admin
    .from("profiles")
    .update({
      youtube_cookies_uploaded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
