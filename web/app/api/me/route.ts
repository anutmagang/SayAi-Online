import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error: ensureErr } = await supabase.rpc("ensure_user_profile");
  if (ensureErr) {
    return NextResponse.json({ error: ensureErr.message }, { status: 500 });
  }

  // Gunakan '*' agar tetap jalan bila migrasi kolom (mis. llm_model_id) belum di-push.
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    email: user.email,
    emailVerified: Boolean(user.email_confirmed_at),
    profile: profile as ProfileRow | null,
  });
}
