import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/** Minimal length — harus sama di `clipper/llm/api_key_pool.py` (`_pool_http_configured`). */
export const API_KEY_POOL_MASTER_SECRET_MIN_LEN = 12;

/** Derive 32-byte AES key from operator secret (must match Python `clipper/llm/api_key_pool.py`). */
function deriveKey(masterSecret: string): Buffer {
  return createHash("sha256").update(masterSecret, "utf8").digest();
}

export function encryptApiKeyPlaintext(masterSecret: string, plaintext: string): string {
  const key = deriveKey(masterSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([enc, tag]);
  return `${iv.toString("base64")}.${combined.toString("base64")}`;
}

export function decryptApiKeyPayload(masterSecret: string, payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 2) throw new Error("invalid ciphertext format");
  const iv = Buffer.from(parts[0], "base64");
  const combined = Buffer.from(parts[1], "base64");
  if (combined.length < 17) throw new Error("ciphertext too short");
  const tag = combined.subarray(combined.length - 16);
  const enc = combined.subarray(0, combined.length - 16);
  const key = deriveKey(masterSecret);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function readMasterSecretForPool():
  | { ok: true; secret: string }
  | { ok: false; error: string } {
  const s = process.env.API_KEY_POOL_MASTER_SECRET?.trim();
  if (!s || s.length < API_KEY_POOL_MASTER_SECRET_MIN_LEN) {
    return {
      ok: false,
      error: `Set variabel API_KEY_POOL_MASTER_SECRET di web/.env.local dan di root .env (nilai sama persis, minimal ${API_KEY_POOL_MASTER_SECRET_MIN_LEN} karakter), lalu restart Next.js / worker.`,
    };
  }
  return { ok: true, secret: s };
}

export function requireMasterSecret(): string {
  const r = readMasterSecretForPool();
  if (!r.ok) throw new Error(r.error);
  return r.secret;
}
