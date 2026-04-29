import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const MAX_BYTES = 400 * 1024;
const OBJECT_NAME = "youtube-cookies.txt";

/** Signed upload ke bucket youtube_cookies — path {userId}/youtube-cookies.txt */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const objectPath = `${user.id}/${OBJECT_NAME}`;
  const admin = createServiceRoleClient();
  const { data, error } = await admin.storage
    .from("youtube_cookies")
    .createSignedUploadUrl(objectPath);

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Bucket youtube_cookies belum ada — jalankan migrasi SQL 024." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    path: objectPath,
    signedUrl: data.signedUrl,
    token: data.token,
    maxBytes: MAX_BYTES,
  });
}
