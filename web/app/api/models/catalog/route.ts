import { NextResponse } from "next/server";
import { parseCachedModelsJson } from "@/lib/llm-catalog-parse";
import {
  emptyCatalogSnapshot,
  type CatalogProviderKey,
  type LlmCatalogApiResponse,
} from "@/lib/llm-catalog-types";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase.from("llm_model_catalog_cache").select("*");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const providers: LlmCatalogApiResponse["providers"] = {
    groq: emptyCatalogSnapshot(),
    gemini: emptyCatalogSnapshot(),
    openai: emptyCatalogSnapshot(),
    openrouter: emptyCatalogSnapshot(),
  };

  for (const row of data ?? []) {
    const p = row.provider as CatalogProviderKey;
    if (p !== "groq" && p !== "gemini" && p !== "openai" && p !== "openrouter") continue;
    providers[p] = {
      liveIds: parseCachedModelsJson(row.models),
      updatedAt: row.updated_at ?? null,
      lastSuccessAt: row.last_success_at ?? null,
      fetchError: row.fetch_error ?? null,
    };
  }

  return NextResponse.json({ providers } satisfies LlmCatalogApiResponse);
}
