import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const OBJECT_NAME = "youtube-cookies.txt";

/** Hapus cookie YouTube milik user dari Storage + profil. */
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = `${user.id}/${OBJECT_NAME}`;
  const admin = createServiceRoleClient();
  await admin.storage.from("youtube_cookies").remove([key]);

  const { error: upErr } = await admin
    .from("profiles")
    .update({
      youtube_cookies_uploaded_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
