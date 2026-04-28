async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`gateway/openrouter request failed (${res.status})`);
    err.meta = json;
    throw err;
  }
  return json;
}

export async function tryGenerateWithOpenRouter(opts) {
  const endpoint =
    process.env.OPENROUTER_IMAGE_ENDPOINT?.trim() ||
    process.env.AI_GATEWAY_ENDPOINT?.trim();
  if (!endpoint) {
    throw new Error("AI_GATEWAY_NOT_CONFIGURED");
  }

  const payload = {
    model: opts.model || process.env.OPENROUTER_IMAGE_MODEL || "openrouter/auto",
    prompt: opts.prompt,
    kind: opts.kind,
    aspect_ratio: opts.aspectRatio,
    duration_sec: opts.durationSec,
  };

  const headers = {
    Authorization: process.env.OPENROUTER_API_KEY?.trim()
      ? `Bearer ${process.env.OPENROUTER_API_KEY.trim()}`
      : "",
    "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "",
    "X-Title": process.env.OPENROUTER_APP_TITLE || "Fai-Clipper",
    "x-ai-gateway-secret": process.env.AI_GATEWAY_SHARED_SECRET || "",
  };

  const json = await postJson(endpoint, payload, headers);

  return {
    provider: json?.provider || "openrouter",
    ...json,
  };
}
