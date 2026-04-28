import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LLM_MODELS_BY_PROVIDER, type LlmProviderId } from "@/lib/llm-models";
import type { Tier } from "@/lib/tiers";

export const runtime = "nodejs";

function limitSummary(tier: Tier, pref: LlmProviderId): { provider: string; model: string; limit: string } {
  const modelLabel =
    pref === "auto"
      ? "Otomatis (platform)"
      : (() => {
          const mid = pref as Exclude<LlmProviderId, "auto">;
          const opts = LLM_MODELS_BY_PROVIDER[mid];
          const first = opts[0];
          return first ? `${first.label} (contoh)` : mid;
        })();

  const limit =
    tier === "free"
      ? "Paket Free: penyedia otomatis (Gemini lalu Groq bila perlu); rotasi key operator; batas sesuai kebijakan platform."
      : tier === "starter"
        ? "Starter: pilih Auto / Groq / Gemini; satu job memakai satu key terpilih dari pool (rotasi per job)."
        : tier === "creator"
          ? "Creator: + OpenAI / OpenRouter; rotasi key per job untuk penyedia yang dipilih."
          : "Pro: semua penyedia yang didukung; rotasi key per job; model dapat dipilih di pengaturan.";

  const providerLabel =
    pref === "auto"
      ? "Auto"
      : pref === "openai"
        ? "OpenAI / OpenRouter (model dengan slash memakai OpenRouter)"
        : pref.charAt(0).toUpperCase() + pref.slice(1);

  return { provider: providerLabel, model: modelLabel, limit };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("tier, llm_preference, llm_model_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !profile) {
    return NextResponse.json({ error: "Profil tidak ditemukan" }, { status: 400 });
  }

  const tier = profile.tier as Tier;
  const pref = profile.llm_preference as LlmProviderId;
  const pinned = profile.llm_model_id as string | null | undefined;
  const modelDisplay =
    pref !== "auto" && pinned?.trim()
      ? (() => {
          const opts = LLM_MODELS_BY_PROVIDER[pref as Exclude<LlmProviderId, "auto">];
          const hit = opts.find((o) => o.id === pinned.trim());
          return hit?.label ?? pinned.trim();
        })()
      : limitSummary(tier, pref).model;

  const base = limitSummary(tier, pref);
  return NextResponse.json({
    provider: base.provider,
    model: modelDisplay,
    limit: base.limit,
  });
}
