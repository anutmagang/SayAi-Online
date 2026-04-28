import type { Tier } from "@/lib/tiers";

const ORDER: Record<Tier, number> = {
  free: 0,
  starter: 1,
  creator: 2,
  pro: 3,
};

export type PaidTier = Exclude<Tier, "free">;

export function tierRank(t: Tier): number {
  return ORDER[t] ?? 0;
}

/** Boleh mengajukan permintaan langganan untuk `candidate` (hanya starter|creator|pro). */
export function canRequestSubscriptionTier(
  current: Tier,
  candidate: PaidTier,
  planExpiresAt: string | null,
): { ok: boolean; reason?: string } {
  if (current === "free") return { ok: true };

  const active = Boolean(planExpiresAt && new Date(planExpiresAt) > new Date());
  const cur = tierRank(current);
  const cand = tierRank(candidate);

  if (cand < cur) {
    return {
      ok: false,
      reason:
        "Tidak bisa mengajukan paket di bawah paket Anda saat ini (tidak ada downgrade lewat halaman ini).",
    };
  }
  if (cand === cur && active) {
    return {
      ok: false,
      reason:
        "Paket ini masih aktif. Perpanjang atau upgrade ke tier lebih tinggi setelah masa aktif berakhir, atau hubungi admin.",
    };
  }
  return { ok: true };
}

export function selectablePaidTiers(
  current: Tier,
  planExpiresAt: string | null,
): PaidTier[] {
  return (["starter", "creator", "pro"] as const).filter(
    (t) => canRequestSubscriptionTier(current, t, planExpiresAt).ok,
  );
}
