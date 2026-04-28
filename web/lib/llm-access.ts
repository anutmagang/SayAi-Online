import type { LlmProviderId } from "@/lib/llm-models";
import type { Tier } from "@/lib/tiers";

/** Preferensi LLM yang diizinkan per paket (selaras RPC `set_llm_preference`). */
export function allowedLlmPreferencesForTier(
  tier: Tier,
  isAdmin: boolean,
): LlmProviderId[] {
  if (isAdmin) {
    return ["auto", "groq", "gemini", "openai", "anthropic"];
  }
  switch (tier) {
    case "free":
      return ["auto"];
    case "starter":
      return ["auto", "groq", "gemini"];
    case "creator":
      return ["auto", "groq", "gemini", "openai"];
    case "pro":
      return ["auto", "groq", "gemini", "openai", "anthropic"];
    default:
      return ["auto"];
  }
}

export function isLlmPreferenceAllowedForTier(
  tier: Tier,
  isAdmin: boolean,
  pref: LlmProviderId,
): boolean {
  return allowedLlmPreferencesForTier(tier, isAdmin).includes(pref);
}

/** Label paket minimum agar opsi penyedia ini tersedia (untuk badge UI). */
export function providerMinimumTierLabel(
  p: Exclude<LlmProviderId, "auto">,
): string {
  if (p === "groq" || p === "gemini") return "Starter+";
  if (p === "openai") return "Creator+";
  return "Pro";
}
