import type { Tier } from "@/lib/tiers";
import { TIER_DETAILS } from "@/lib/tiers";

/**
 * Harga referensi **1 kredit** untuk top-up manual (IDR).
 * Tampil di dashboard; setoran bank harus disesuaikan admin saat verifikasi.
 */
export const CREDIT_TOPUP_UNIT_PRICE_IDR = 10_000;

/**
 * Bonus kredit saat langganan disetujui — **sumber angka**: `TIER_DETAILS[t].bonusCreditsOnSubscription`
 * (agar UI, copy, dan migrasi SQL `admin_review_subscription` mudah diselaraskan).
 */
export function subscriptionApprovalBonusCredits(tier: Exclude<Tier, "free">): number {
  return TIER_DETAILS[tier].bonusCreditsOnSubscription ?? 0;
}

export function formatCreditTopupUnitPrice(): string {
  return `Rp ${CREDIT_TOPUP_UNIT_PRICE_IDR.toLocaleString("id-ID")} / kredit`;
}

export function estimatedTopupPaymentIdr(credits: number): number {
  if (!Number.isFinite(credits) || credits < 1) return 0;
  return Math.floor(credits) * CREDIT_TOPUP_UNIT_PRICE_IDR;
}

/** Nilai referensi bonus dalam IDR (harga kredit × jumlah) — untuk copy marketing. */
export function subscriptionBonusApproxValueIdr(tier: Exclude<Tier, "free">): number {
  const n = subscriptionApprovalBonusCredits(tier);
  return n * CREDIT_TOPUP_UNIT_PRICE_IDR;
}
