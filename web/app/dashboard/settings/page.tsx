import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

const WM_POS = new Set([
  "top_left",
  "top_right",
  "bottom_left",
  "bottom_right",
  "center",
]);

function normalizeWatermarkPosition(raw: string | null | undefined) {
  const t = raw?.trim();
  if (t && WM_POS.has(t)) {
    return t as "top_left" | "top_right" | "bottom_left" | "bottom_right" | "center";
  }
  return "bottom_right" as const;
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <SettingsClient
      email={user.email ?? ""}
      tier={(profile?.tier as "free" | "starter" | "creator" | "pro") ?? "free"}
      isAdmin={Boolean(profile?.is_admin)}
      llmPreference={
        (profile?.llm_preference as
          | "auto"
          | "groq"
          | "gemini"
          | "openai"
          | "anthropic") ?? "auto"
      }
      llmModelId={profile?.llm_model_id ?? null}
      watermarkPaidEnabled={Boolean(profile?.watermark_paid_enabled)}
      watermarkCustomText={profile?.watermark_custom_text ?? ""}
      watermarkPosition={normalizeWatermarkPosition(profile?.watermark_position)}
      youtubeCookiesUploadedAt={profile?.youtube_cookies_uploaded_at ?? null}
    />
  );
}
