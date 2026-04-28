import "server-only";

export type ProbeResult = { ok: boolean; status?: number; detail?: string };

export async function probeProviderKey(provider: string, apiKey: string): Promise<ProbeResult> {
  const key = apiKey.trim();
  if (!key) return { ok: false, detail: "empty_key" };
  const signal = AbortSignal.timeout(25_000);
  try {
    switch (provider) {
      case "groq": {
        const res = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
          signal,
        });
        if (res.ok) return { ok: true, status: res.status };
        return { ok: false, status: res.status, detail: await res.text().catch(() => "") };
      }
      case "gemini": {
        const u = new URL("https://generativelanguage.googleapis.com/v1beta/models");
        u.searchParams.set("pageSize", "1");
        u.searchParams.set("key", key);
        const res = await fetch(u.toString(), { method: "GET", signal });
        if (res.ok) return { ok: true, status: res.status };
        return { ok: false, status: res.status, detail: await res.text().catch(() => "") };
      }
      case "openai": {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
          signal,
        });
        if (res.ok) return { ok: true, status: res.status };
        return { ok: false, status: res.status, detail: await res.text().catch(() => "") };
      }
      case "openrouter": {
        const res = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
          signal,
        });
        if (res.ok) return { ok: true, status: res.status };
        return { ok: false, status: res.status, detail: await res.text().catch(() => "") };
      }
      case "anthropic": {
        const res = await fetch("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
          signal,
        });
        if (res.ok) return { ok: true, status: res.status };
        if (res.status === 404) return { ok: true, status: 404, detail: "models_route_unavailable" };
        return { ok: false, status: res.status, detail: await res.text().catch(() => "") };
      }
      default:
        return { ok: false, detail: "unknown_provider" };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: msg.slice(0, 400) };
  }
}
