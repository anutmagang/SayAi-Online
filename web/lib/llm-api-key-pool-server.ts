import "server-only";

import {
  API_KEY_POOL_MASTER_SECRET_MIN_LEN,
  decryptApiKeyPayload,
} from "@/lib/api-key-pool-crypto";
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { CatalogProviderKey } from "@/lib/llm-catalog-types";

function rowPastCooldown(row: { cooldown_until?: string | null }): boolean {
  const raw = row.cooldown_until;
  if (!raw) return true;
  const until = new Date(raw).getTime();
  if (Number.isNaN(until)) return true;
  return until <= Date.now();
}

/** Katalog model: default sertakan key meski cooldown (refresh tetap jalan). */
export async function listDecryptedPoolKeysForProvider(
  provider: CatalogProviderKey,
  opts?: { respectCooldown?: boolean },
): Promise<string[]> {
  const respectCooldown = opts?.respectCooldown === true;
  const master = process.env.API_KEY_POOL_MASTER_SECRET?.trim();
  if (!master || master.length < API_KEY_POOL_MASTER_SECRET_MIN_LEN) return [];

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("operator_llm_api_key_pool")
    .select("secret_ciphertext,sort_order,id,cooldown_until")
    .eq("provider", provider)
    .eq("enabled", true)
    .order("sort_order", { ascending: true });

  if (error || !data?.length) return [];

  const keys: string[] = [];
  for (const row of data) {
    if (respectCooldown && !rowPastCooldown(row)) continue;
    const blob = (row.secret_ciphertext as string | null)?.trim();
    if (!blob) continue;
    try {
      const plain = decryptApiKeyPayload(master, blob).trim();
      if (plain && !keys.includes(plain)) keys.push(plain);
    } catch {
      /* skip broken row */
    }
  }
  return keys;
}

export function mergePoolKeysWithEnv(poolKeys: string[], envKey: string | undefined): string[] {
  const env = envKey?.trim() ?? "";
  const out: string[] = [];
  for (const k of poolKeys) {
    if (k && !out.includes(k)) out.push(k);
  }
  if (env && !out.includes(env)) out.push(env);
  return out;
}

export function isRateLimitFetchError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("429") || m.includes("rate") || m.includes("too many");
}
