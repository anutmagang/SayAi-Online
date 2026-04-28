import "server-only";

import {
  isRateLimitFetchError,
  listDecryptedPoolKeysForProvider,
  mergePoolKeysWithEnv,
} from "@/lib/llm-api-key-pool-server";
import { parseCachedModelsJson } from "@/lib/llm-catalog-parse";
import type { CatalogProviderKey } from "@/lib/llm-catalog-types";
import { createServiceRoleClient } from "@/lib/supabase/service";

export type { CatalogProviderKey } from "@/lib/llm-catalog-types";

export function verifyCronAuth(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const q = new URL(request.url).searchParams.get("secret");
  if (q === secret) return true;
  const h = request.headers.get("x-cron-secret");
  if (h === secret) return true;
  return false;
}

async function fetchGroqModelIds(apiKey: string): Promise<{ ids: string[]; error?: string }> {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      return { ids: [], error: `Groq HTTP ${res.status}` };
    }
    const data = (await res.json()) as { data?: { id?: string }[] };
    const ids = (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id && typeof id === "string"))
      .sort();
    return { ids };
  } catch (e) {
    return { ids: [], error: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchGeminiModelIds(apiKey: string): Promise<{ ids: string[]; error?: string }> {
  try {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("key", apiKey);
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) {
      return { ids: [], error: `Gemini HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      models?: {
        name?: string;
        supportedGenerationMethods?: string[];
      }[];
    };
    const ids: string[] = [];
    for (const m of data.models ?? []) {
      const name = m.name ?? "";
      if (name.toLowerCase().includes("embed")) continue;
      const methods = m.supportedGenerationMethods ?? [];
      if (!methods.includes("generateContent")) continue;
      const short = name.includes("/") ? name.split("/").pop() ?? name : name;
      if (short) ids.push(short);
    }
    ids.sort();
    return { ids };
  } catch (e) {
    return { ids: [], error: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchOpenAiCompatibleModelIds(
  apiKey: string,
  baseUrlRaw: string | undefined,
): Promise<{ ids: string[]; error?: string }> {
  const trimmed = (baseUrlRaw ?? "").trim();
  const base =
    trimmed.replace(/\/$/, "") ||
    "https://api.openai.com/v1";
  const modelsUrl = `${base}/models`;
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    const referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
    const title = process.env.OPENROUTER_APP_TITLE?.trim();
    if (referer) headers["HTTP-Referer"] = referer;
    if (title) headers["X-Title"] = title;

    const res = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(45_000) });
    if (!res.ok) {
      return { ids: [], error: `OpenAI-compatible HTTP ${res.status}` };
    }
    const data = (await res.json()) as { data?: { id?: string }[] };
    const ids = (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id && typeof id === "string"))
      .sort();
    return { ids };
  } catch (e) {
    return { ids: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export type RefreshLlmCatalogResult = {
  ok: boolean;
  providers: Record<
    CatalogProviderKey,
    | { status: "updated"; count: number }
    | { status: "error"; message: string }
    | { status: "skipped"; reason: string }
  >;
};

export async function refreshLlmModelCatalog(): Promise<RefreshLlmCatalogResult> {
  const admin = createServiceRoleClient();
  const now = new Date().toISOString();
  const out: RefreshLlmCatalogResult["providers"] = {
    groq: { status: "skipped", reason: "internal" },
    gemini: { status: "skipped", reason: "internal" },
    openai: { status: "skipped", reason: "internal" },
    openrouter: { status: "skipped", reason: "internal" },
  };

  async function upsertProvider(
    provider: CatalogProviderKey,
    result: { ids: string[]; error?: string },
  ) {
    const { data: row } = await admin
      .from("llm_model_catalog_cache")
      .select("models, last_success_at")
      .eq("provider", provider)
      .maybeSingle();

    const prevModels = parseCachedModelsJson(row?.models);
    const prevSuccess = (row as { last_success_at?: string | null } | null)?.last_success_at ?? null;

    if (result.error) {
      const { error } = await admin.from("llm_model_catalog_cache").upsert(
        {
          provider,
          models: prevModels,
          fetch_error: result.error.slice(0, 2000),
          updated_at: now,
          last_success_at: prevSuccess,
        },
        { onConflict: "provider" },
      );
      if (error) throw new Error(error.message);
      out[provider] = { status: "error", message: result.error };
      return;
    }

    const { error } = await admin.from("llm_model_catalog_cache").upsert(
      {
        provider,
        models: result.ids,
        fetch_error: null,
        updated_at: now,
        last_success_at: now,
      },
      { onConflict: "provider" },
    );
    if (error) throw new Error(error.message);
    out[provider] = { status: "updated", count: result.ids.length };
  }

  const groqKeys = mergePoolKeysWithEnv(
    await listDecryptedPoolKeysForProvider("groq"),
    process.env.GROQ_API_KEY,
  );
  if (groqKeys.length) {
    let last: { ids: string[]; error?: string } = { ids: [], error: "no response" };
    for (let i = 0; i < groqKeys.length; i++) {
      const k = groqKeys[i]!;
      const r = await fetchGroqModelIds(k);
      if (!r.error) {
        last = r;
        break;
      }
      last = r;
      if (isRateLimitFetchError(r.error ?? "") && i < groqKeys.length - 1) continue;
      break;
    }
    await upsertProvider("groq", last);
  } else {
    out.groq = { status: "skipped", reason: "Tidak ada GROQ_API_KEY / stok pool Groq" };
  }

  const geminiKeys = mergePoolKeysWithEnv(
    await listDecryptedPoolKeysForProvider("gemini"),
    process.env.GEMINI_API_KEY,
  );
  if (geminiKeys.length) {
    let last: { ids: string[]; error?: string } = { ids: [], error: "no response" };
    for (let i = 0; i < geminiKeys.length; i++) {
      const k = geminiKeys[i]!;
      const r = await fetchGeminiModelIds(k);
      if (!r.error) {
        last = r;
        break;
      }
      last = r;
      if (isRateLimitFetchError(r.error ?? "") && i < geminiKeys.length - 1) continue;
      break;
    }
    await upsertProvider("gemini", last);
  } else {
    out.gemini = { status: "skipped", reason: "Tidak ada GEMINI_API_KEY / stok pool Gemini" };
  }

  const legacyOpenRouterViaOpenAi =
    (process.env.OPENAI_BASE_URL ?? "").toLowerCase().includes("openrouter.ai");

  const openaiOfficialKeys = legacyOpenRouterViaOpenAi
    ? []
    : mergePoolKeysWithEnv(
        await listDecryptedPoolKeysForProvider("openai"),
        process.env.OPENAI_API_KEY,
      );
  if (openaiOfficialKeys.length) {
    const officialBase = (() => {
      const b = (process.env.OPENAI_BASE_URL ?? "").trim();
      if (!b || b.toLowerCase().includes("openrouter.ai")) return undefined;
      return b;
    })();
    let last: { ids: string[]; error?: string } = { ids: [], error: "no response" };
    for (let i = 0; i < openaiOfficialKeys.length; i++) {
      const k = openaiOfficialKeys[i]!;
      const r = await fetchOpenAiCompatibleModelIds(k, officialBase);
      if (!r.error) {
        last = r;
        break;
      }
      last = r;
      if (isRateLimitFetchError(r.error ?? "") && i < openaiOfficialKeys.length - 1) continue;
      break;
    }
    await upsertProvider("openai", last);
  } else {
    out.openai = { status: "skipped", reason: "Tidak ada key API OpenAI resmi / stok pool openai" };
  }

  let openrouterKeys = mergePoolKeysWithEnv(
    await listDecryptedPoolKeysForProvider("openrouter"),
    process.env.OPENROUTER_API_KEY,
  );
  if (!openrouterKeys.length && legacyOpenRouterViaOpenAi) {
    openrouterKeys = mergePoolKeysWithEnv(
      await listDecryptedPoolKeysForProvider("openai"),
      process.env.OPENAI_API_KEY,
    );
  }
  const orBase =
    (process.env.OPENROUTER_BASE_URL ?? "").trim().replace(/\/$/, "") ||
    "https://openrouter.ai/api/v1";
  if (openrouterKeys.length) {
    let last: { ids: string[]; error?: string } = { ids: [], error: "no response" };
    for (let i = 0; i < openrouterKeys.length; i++) {
      const k = openrouterKeys[i]!;
      const r = await fetchOpenAiCompatibleModelIds(k, orBase);
      if (!r.error) {
        last = r;
        break;
      }
      last = r;
      if (isRateLimitFetchError(r.error ?? "") && i < openrouterKeys.length - 1) continue;
      break;
    }
    await upsertProvider("openrouter", last);
  } else {
    out.openrouter = {
      status: "skipped",
      reason: "Tidak ada OPENROUTER_API_KEY / stok pool openrouter (atau legacy OPENAI_* ke OR)",
    };
  }

  return { ok: true, providers: out };
}
