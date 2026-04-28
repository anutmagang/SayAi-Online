export type AIJobKind = "image_gen" | "video_gen";
export type AIAspectRatio = "1:1" | "9:16" | "16:9" | "4:3" | "3:4";
export type AITier = "free" | "starter" | "creator" | "pro";

const MODEL_MULTIPLIER: Record<string, number> = {
  "fast": 1,
  "quality": 1.5,
  "cinematic": 2,
};

const ASPECT_MULTIPLIER: Record<AIAspectRatio, number> = {
  "1:1": 1,
  "9:16": 1.15,
  "16:9": 1.2,
  "4:3": 1.08,
  "3:4": 1.08,
};

const TIER_MULTIPLIER: Record<AITier, number> = {
  free: 1.2,
  starter: 1,
  creator: 0.95,
  pro: 0.9,
};

export function estimateAICredits(args: {
  kind: AIJobKind;
  durationSec?: number;
  model?: string;
  aspectRatio?: AIAspectRatio;
  tier?: AITier;
}) {
  const kind = args.kind;
  const duration = Math.max(2, Math.min(12, Number(args.durationSec ?? 4)));
  const ar = (args.aspectRatio ?? "1:1") as AIAspectRatio;
  const tier = (args.tier ?? "free") as AITier;
  const modelRaw = (args.model ?? "fast").toLowerCase();
  const modelBucket = modelRaw.includes("quality") || modelRaw.includes("pro")
    ? "quality"
    : modelRaw.includes("cinematic") || modelRaw.includes("video")
      ? "cinematic"
      : "fast";

  const base = kind === "image_gen" ? 2 : Math.max(8, duration * 2);
  const weighted = Math.ceil(
    base *
      MODEL_MULTIPLIER[modelBucket] *
      ASPECT_MULTIPLIER[ar] *
      TIER_MULTIPLIER[tier],
  );

  return {
    credits: Math.max(kind === "image_gen" ? 2 : 8, weighted),
    modelBucket,
  };
}
