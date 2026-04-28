export type CatalogProviderKey = "groq" | "gemini" | "openai" | "openrouter";

export type LlmCatalogProviderSnapshot = {
  liveIds: string[];
  updatedAt: string | null;
  lastSuccessAt: string | null;
  fetchError: string | null;
};

export type LlmCatalogApiResponse = {
  providers: Record<CatalogProviderKey, LlmCatalogProviderSnapshot>;
};

export function emptyCatalogSnapshot(): LlmCatalogProviderSnapshot {
  return {
    liveIds: [],
    updatedAt: null,
    lastSuccessAt: null,
    fetchError: null,
  };
}
