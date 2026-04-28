import { z } from "zod";
import { MIN_CLIPS_PER_JOB } from "@/lib/tiers";
import { isYoutubeUrl } from "@/lib/url-validator";

const clipMinDurationSecSchema = z.coerce
  .number()
  .min(10)
  .max(120)
  .optional()
  .describe("Durasi tiap klip — batas bawah (detik), default 20.");

const clipMaxDurationSecSchema = z.coerce
  .number()
  .min(15)
  .max(180)
  .optional()
  .describe("Durasi tiap klip — batas atas (detik), default 90.");

/** Shorts/Reels/TikTok 9:16 vs konten YouTube/horizontal 16:9. */
const outputLayoutSchema = z
  .enum(["short_vertical", "long_horizontal"])
  .optional()
  .describe("Layout output: short_vertical (9:16) atau long_horizontal (16:9).");

export function createJobPostBodySchema(maxClipsUpper: number) {
  const maxClipsSchema = z
    .number()
    .int()
    .min(MIN_CLIPS_PER_JOB)
    .max(maxClipsUpper)
    .optional()
    .describe(`Jumlah klip maksimal per job (${MIN_CLIPS_PER_JOB}–${maxClipsUpper} untuk paket Anda).`);

  return z
    .union([
      z.object({
        kind: z.literal("url"),
        url: z
          .string()
          .url()
          .max(2000)
          .refine(isYoutubeUrl, {
            message:
              "Saat ini hanya URL YouTube yang didukung (youtube.com / youtu.be). Untuk platform lain, unduh dulu lalu upload filenya.",
          }),
        maxClips: maxClipsSchema,
        clipMinDurationSec: clipMinDurationSecSchema,
        clipMaxDurationSec: clipMaxDurationSecSchema,
        outputLayout: outputLayoutSchema,
      }),
      z.object({
        kind: z.literal("upload"),
        storagePath: z
          .string()
          .min(1)
          .max(500)
          .regex(/^[A-Za-z0-9/_.\-]+$/, "Karakter storage path tidak valid"),
        originalName: z.string().max(240).optional(),
        maxClips: maxClipsSchema,
        clipMinDurationSec: clipMinDurationSecSchema,
        clipMaxDurationSec: clipMaxDurationSecSchema,
        outputLayout: outputLayoutSchema,
      }),
    ])
    .superRefine((data, ctx) => {
      const lo = data.clipMinDurationSec ?? 20;
      const hi = data.clipMaxDurationSec ?? 90;
      if (hi < lo + 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Durasi maksimal harus minimal (minimal + 5) detik.",
          path: ["clipMaxDurationSec"],
        });
      }
    });
}
