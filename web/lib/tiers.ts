export type Tier = "free" | "starter" | "creator" | "pro";

/** Satu job — batas bawah (semua tier). */
export const MIN_CLIPS_PER_JOB = 1;
/** Plafon form/API (nilai terbesar yang bisa diminta; tier membatasi lebih ketat). */
export const MAX_CLIPS_PER_JOB = 20;

/** Maks klip per job mengikuti paket (hemat token & render untuk Free). */
export const MAX_CLIPS_PER_JOB_BY_TIER: Record<Tier, number> = {
  free: 5,
  starter: 10,
  creator: 15,
  pro: 20,
};

export function maxClipsAllowedForTier(tier: Tier): number {
  return MAX_CLIPS_PER_JOB_BY_TIER[tier] ?? MAX_CLIPS_PER_JOB_BY_TIER.free;
}

/**
 * Durasi maksimal video **sumber** (YouTube / upload) per tier, dalam jam.
 * Harus selaras dengan default `clipper/config.py` (Free 1h, berbayar 2h).
 */
export const MAX_SOURCE_VIDEO_HOURS: Record<Tier, number> = {
  free: 1,
  starter: 2,
  creator: 2,
  pro: 2,
};

/** Copy generik (landing, onboarding) bila tidak ada konteks tier login. */
export const SOURCE_VIDEO_DURATION_HELP_ID =
  "Paket Free: video sumber hingga 1 jam. Starter, Creator & Pro: hingga 2 jam.";

/** Helper form dashboard: batas durasi video sumber sesuai tier akun (selaras `MAX_SOURCE_VIDEO_HOURS`). */
export function sourceDurationHintForTier(tier: Tier): string {
  const hours = MAX_SOURCE_VIDEO_HOURS[tier];
  const label = TIER_DETAILS[tier].label;
  if (tier === "free") {
    return `Paket Anda (${label}): video sumber hingga ${hours} jam. Starter, Creator & Pro: hingga ${MAX_SOURCE_VIDEO_HOURS.starter} jam.`;
  }
  return `Paket Anda (${label}): video sumber hingga ${hours} jam.`;
}

/** Dashboard / form: admin testing copy + billing tier label. */
export function sourceDurationHintForAccount(tier: Tier, isAdmin: boolean): string {
  if (isAdmin) {
    const h = MAX_SOURCE_VIDEO_HOURS.pro;
    return `Admin: video sumber hingga ${h} jam untuk pengujian; job tidak mengurangi kredit atau kuota. Paket billing: ${TIER_DETAILS[tier].label}.`;
  }
  return sourceDurationHintForTier(tier);
}

export const TIER_DETAILS: Record<
  Tier,
  {
    label: string;
    monthlyQuota: number;
    priceIdr: number;
    /** Kredit tambahan sekali saat admin menyetujui langganan (tier berbayar). Selaras migrasi SQL `admin_review_subscription`. */
    bonusCreditsOnSubscription?: number;
    llmDescription: string;
    features: string[];
    watermark: boolean;
  }
> = {
  free: {
    label: "Free",
    monthlyQuota: 0,
    priceIdr: 0,
    llmDescription: "Gemini lalu Groq (free tier API — otomatis fallback)",
    features: [
      "5 kredit awal setelah daftar",
      `Maksimal ${MAX_CLIPS_PER_JOB_BY_TIER.free} klip per job`,
      "Potongan 9:16 otomatis dengan face tracking",
      "Karaoke captions word-by-word",
      "Watermark kecil di pojok bawah",
    ],
    watermark: true,
  },
  starter: {
    label: "Starter",
    monthlyQuota: 30,
    priceIdr: 62_000,
    bonusCreditsOnSubscription: 12,
    llmDescription: "Groq Llama 3.3 70B + Gemini 2.5 Flash",
    features: [
      "30 job klip per bulan",
      `Maksimal ${MAX_CLIPS_PER_JOB_BY_TIER.starter} klip per job`,
      "+12 kredit bonus setelah langganan disetujui (sekali)",
      "Tanpa watermark",
      "Pilih penyedia AI: Auto, Groq, atau Gemini di Settings",
      "Antrean prioritas normal",
      "Semua fitur Free",
    ],
    watermark: false,
  },
  creator: {
    label: "Creator",
    monthlyQuota: 90,
    priceIdr: 145_000,
    bonusCreditsOnSubscription: 30,
    llmDescription: "Gemini 2.5 Flash + Groq Whisper Turbo",
    features: [
      "90 job klip per bulan",
      `Maksimal ${MAX_CLIPS_PER_JOB_BY_TIER.creator} klip per job`,
      "+30 kredit bonus setelah langganan disetujui (sekali)",
      "Tanpa watermark",
      "Pilih penyedia: Auto, Groq, Gemini, atau OpenAI di Settings",
      "ZIP download semua klip",
      "Semua fitur Starter",
    ],
    watermark: false,
  },
  pro: {
    label: "Pro",
    monthlyQuota: 250,
    priceIdr: 335_000,
    bonusCreditsOnSubscription: 52,
    llmDescription: "Pilih sendiri: Claude / GPT-4o / Gemini Pro",
    features: [
      "250 job klip per bulan",
      `Maksimal ${MAX_CLIPS_PER_JOB_BY_TIER.pro} klip per job`,
      "+52 kredit bonus setelah langganan disetujui (sekali)",
      "Semua penyedia AI (termasuk Anthropic) di Settings",
      "Antrean prioritas tertinggi",
      "ZIP download semua klip",
      "Tanpa watermark",
    ],
    watermark: false,
  },
};

export function formatIdr(value: number): string {
  return `Rp ${value.toLocaleString("id-ID")}`;
}
