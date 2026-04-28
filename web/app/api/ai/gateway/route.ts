import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const schema = z.object({
  kind: z.enum(["image_gen", "video_gen"]),
  prompt: z.string().min(3).max(2000),
  model: z.string().max(200).optional(),
  aspect_ratio: z.enum(["1:1", "9:16", "16:9", "4:3", "3:4"]).default("1:1"),
  duration_sec: z.coerce.number().int().min(2).max(12).optional(),
});

function sizeFromAspect(ar: string) {
  switch (ar) {
    case "9:16":
      return { width: 1024, height: 1792, size: "1024x1792" };
    case "16:9":
      return { width: 1792, height: 1024, size: "1792x1024" };
    case "4:3":
      return { width: 1536, height: 1152, size: "1536x1152" };
    case "3:4":
      return { width: 1152, height: 1536, size: "1152x1536" };
    default:
      return { width: 1024, height: 1024, size: "1024x1024" };
  }
}

async function ensureAuthenticatedOrInternal(req: Request) {
  const secret = process.env.AI_GATEWAY_SHARED_SECRET?.trim();
  const provided = req.headers.get("x-ai-gateway-secret")?.trim();
  if (secret && provided && provided === secret) return true;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return Boolean(user);
}

async function callOpenAIImage(prompt: string, model: string, size: string) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY missing");

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      size,
      response_format: "b64_json",
    }),
  });

  const raw = await res.text();
  let json: any = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { raw };
  }

  if (!res.ok) {
    const msg = json?.error?.message || `OpenAI image failed (${res.status})`;
    throw new Error(msg);
  }

  const b64 = json?.data?.[0]?.b64_json;
  const url = json?.data?.[0]?.url;
  if (!b64 && !url) throw new Error("OpenAI image response missing data");

  return { b64, url };
}

export async function POST(req: Request) {
  const allowed = await ensureAuthenticatedOrInternal(req);
  if (!allowed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload gateway tidak valid" }, { status: 400 });
  }

  const { kind, prompt, aspect_ratio } = parsed.data;
  const sz = sizeFromAspect(aspect_ratio);

  if (kind === "video_gen") {
    return NextResponse.json({
      kind: "video",
      mime: "video/mp4",
      provider: "gateway-mock-video",
      width: sz.width,
      height: sz.height,
      duration_sec: parsed.data.duration_sec ?? 4,
      note: "Video provider langsung belum diaktifkan; worker akan materialize video via ffmpeg fallback.",
    });
  }

  const model = parsed.data.model?.trim() || process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1";
  try {
    const out = await callOpenAIImage(prompt, model, sz.size);
    return NextResponse.json({
      kind: "image",
      mime: "image/png",
      provider: "openai-images",
      width: sz.width,
      height: sz.height,
      base64: out.b64,
      url: out.url,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        kind: "image",
        mime: "image/png",
        provider: "gateway-fallback",
        width: sz.width,
        height: sz.height,
        note: e?.message || "OpenAI image unavailable; worker will fallback materialization.",
      },
      { status: 200 },
    );
  }
}
