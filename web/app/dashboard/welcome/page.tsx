import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SOURCE_VIDEO_DURATION_HELP_ID } from "@/lib/tiers";
import { WelcomeClient } from "./welcome-client";

export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  await supabase.rpc("ensure_user_profile");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profile?.onboarding_completed_at) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto max-w-lg space-y-8 py-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Selamat datang</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Fai-Clipper memproses video di server kami. Anda mulai di paket Free dengan
          5 kredit onboarding — cukup untuk mencoba pipeline end-to-end. Upgrade ke
          Starter, Creator, atau Pro bila sudah cocok.
        </p>
      </div>
      <ol className="list-decimal space-y-3 pl-5 text-sm text-ink-muted">
        <li>
          Buat job dari URL YouTube / file (maks 2 GB). {SOURCE_VIDEO_DURATION_HELP_ID}
        </li>
        <li>
          Pipeline: transcribe (Groq Whisper) → analisa AI → render 9:16 dengan caption
          karaoke.
        </li>
        <li>Unduh tiap klip atau ZIP semua klip.</li>
        <li>Untuk volume lebih besar: upgrade ke Starter, Creator, atau Pro.</li>
      </ol>
      <WelcomeClient />
    </div>
  );
}
