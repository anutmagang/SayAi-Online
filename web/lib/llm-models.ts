/** Allowed models per vendor — keep in sync with clipper/llm/model_allowlist.py
 *  Gemini IDs disaring dari models.list (generateContent). Groq dari dokumentasi
 *  produksi GroqCloud (Apr 2026); jalankan scripts/list_provider_models.py untuk
 *  cek key Anda.
 */

export type LlmProviderId =
  | "auto"
  | "groq"
  | "gemini"
  | "openai"
  | "anthropic";

export type LlmModelOption = { id: string; label: string };

export const LLM_MODELS_BY_PROVIDER: Record<
  Exclude<LlmProviderId, "auto">,
  LlmModelOption[]
> = {
  groq: [
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (default, produksi)" },
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" },
    { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B (Groq)" },
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B (Groq)" },
    { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B (preview)" },
    { id: "qwen/qwen3-32b", label: "Qwen3 32B (preview)" },
  ],
  gemini: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (default, stabil)" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { id: "gemini-2.0-flash-001", label: "Gemini 2.0 Flash 001" },
    { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash-Lite" },
    { id: "gemini-2.0-flash-lite-001", label: "Gemini 2.0 Flash-Lite 001" },
    { id: "gemini-flash-latest", label: "Gemini Flash (alias latest)" },
    { id: "gemini-flash-lite-latest", label: "Gemini Flash-Lite (alias latest)" },
    { id: "gemini-pro-latest", label: "Gemini Pro (alias latest)" },
    { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash (legacy)" },
    { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro (legacy)" },
  ],
  openai: [
    { id: "gpt-4o-mini", label: "OpenAI: GPT-4o mini (default)" },
    { id: "gpt-4o", label: "OpenAI: GPT-4o" },
    { id: "gpt-4-turbo", label: "OpenAI: GPT-4 Turbo" },
    { id: "deepseek/deepseek-chat", label: "OpenRouter: DeepSeek Chat" },
    { id: "deepseek/deepseek-r1", label: "OpenRouter: DeepSeek R1" },
    { id: "openai/gpt-4o-mini", label: "OpenRouter: GPT-4o mini" },
    { id: "openai/gpt-4o", label: "OpenRouter: GPT-4o" },
    { id: "anthropic/claude-3.5-sonnet", label: "OpenRouter: Claude 3.5 Sonnet" },
    { id: "google/gemini-2.0-flash-001", label: "OpenRouter: Gemini 2.0 Flash" },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "OpenRouter: Llama 3.3 70B" },
  ],
  anthropic: [
    {
      id: "claude-3-5-sonnet-20241022",
      label: "Claude 3.5 Sonnet (default)",
    },
    { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
    { id: "claude-3-opus-20240229", label: "Claude 3 Opus" },
  ],
};

export function isAllowedLlmModel(
  provider: Exclude<LlmProviderId, "auto">,
  modelId: string,
): boolean {
  const m = modelId.trim();
  return LLM_MODELS_BY_PROVIDER[provider].some((o) => o.id === m);
}

const OPENROUTER_SLUG_RE =
  /^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,63}$/i;

function isOpenRouterConfiguredInEnv(): boolean {
  if ((process.env.OPENROUTER_API_KEY ?? "").trim()) return true;
  if ((process.env.OPENAI_BASE_URL ?? "").toLowerCase().includes("openrouter.ai")) return true;
  return false;
}

/** OpenAI resmi (gpt-*) + slug OpenRouter `vendor/model` bila OpenRouter dikonfigurasi. */
export function isAllowedOpenAiCompatibleModelId(modelId: string): boolean {
  const m = modelId.trim();
  if (m.length > 120) return false;
  if (LLM_MODELS_BY_PROVIDER.openai.some((o) => o.id === m)) return true;
  if (isOpenRouterConfiguredInEnv() && OPENROUTER_SLUG_RE.test(m)) return true;
  return false;
}
