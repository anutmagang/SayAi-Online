/** Parse JSONB `models` from llm_model_catalog_cache (string[] or {id}[]). */
export function parseCachedModelsJson(models: unknown): string[] {
  if (!Array.isArray(models)) return [];
  const out: string[] = [];
  for (const item of models) {
    if (typeof item === "string") out.push(item);
    else if (item && typeof item === "object" && "id" in item && typeof (item as { id: unknown }).id === "string") {
      out.push((item as { id: string }).id);
    }
  }
  return out;
}
