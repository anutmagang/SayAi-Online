import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isLlmPreferenceAllowedForTier } from "@/lib/llm-access";
import {
  isAllowedLlmModel,
  isAllowedOpenAiCompatibleModelId,
  type LlmProviderId,
} from "@/lib/llm-models";
import type { Tier } from "@/lib/tiers";

export const runtime = "nodejs";

const prefEnum = z.enum(["auto", "groq", "gemini", "openai", "anthropic"]);

const schema = z.object({
  preference: prefEnum,
  modelId: z.string().max(120).nullable().optional(),
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
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("tier, is_admin")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profErr || !profile) {
    return NextResponse.json({ error: "Profil tidak ditemukan" }, { status: 400 });
  }

  const tier = profile.tier as Tier;
  const isAdmin = Boolean(profile.is_admin);
  const pref = parsed.data.preference as LlmProviderId;
  let modelId: string | null =
    parsed.data.modelId == null || parsed.data.modelId === ""
      ? null
      : parsed.data.modelId.trim();

  if (!isLlmPreferenceAllowedForTier(tier, isAdmin, pref)) {
    return NextResponse.json(
      {
        error:
          "Penyedia AI ini tidak termasuk paket langganan Anda. Pilih opsi yang sesuai tier (Starter: Auto/Groq/Gemini; Creator: +OpenAI; Pro: semua).",
      },
      { status: 403 },
    );
  }

  if (pref === "auto") {
    modelId = null;
  } else if (modelId) {
    const ok =
      pref === "openai"
        ? isAllowedOpenAiCompatibleModelId(modelId)
        : isAllowedLlmModel(pref, modelId);
    if (!ok) {
      return NextResponse.json(
        { error: "Model tidak didukung untuk penyedia ini." },
        { status: 400 },
      );
    }
  }

  const { error } = await supabase.rpc("set_llm_preference", {
    p_1_pref: pref,
    p_2_model_id: modelId,
  });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("PAID_TIER_REQUIRED")) {
      return NextResponse.json(
        {
          error:
            "Paket Free hanya mendukung mode Auto. Upgrade langganan untuk memilih penyedia lain.",
        },
        { status: 403 },
      );
    }
    if (msg.includes("LLM_PREF_NOT_ALLOWED_FOR_TIER")) {
      return NextResponse.json(
        {
          error:
            "Penyedia ini tidak diizinkan untuk paket Anda. Sesuaikan pilihan dengan tier Starter / Creator / Pro.",
        },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
