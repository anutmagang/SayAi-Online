"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ProfileRow } from "@/lib/types";
import { TIER_DETAILS } from "@/lib/tiers";

type MePayload = {
  email: string | null;
  emailVerified: boolean;
  profile: ProfileRow | null;
};

async function fetchMe(): Promise<MePayload> {
  const res = await fetch("/api/me");
  if (!res.ok) throw new Error("Gagal memuat profil");
  return res.json() as Promise<MePayload>;
}

export function CreditsStrip() {
  const { data, isError } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    refetchInterval: 30_000,
  });

  if (isError || !data?.profile) return null;

  const {
    tier,
    is_admin: isAdmin,
    credits_balance: bal,
    monthly_quota,
    monthly_used,
    plan_expires_at,
  } = data.profile;

  const d = TIER_DETAILS[tier];
  const remaining = Math.max(0, monthly_quota - monthly_used);
  const isPaid = tier !== "free";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-edge bg-subtle px-4 py-2 text-sm text-ink">
      <span className="text-ink-muted">Status:</span>
      <span className="font-medium">{isAdmin ? "Admin" : d.label}</span>
      {isAdmin ? (
        <span className="text-xs text-ink-muted">
          (billing {d.label}) · job tidak mengurangi kredit/kuota
        </span>
      ) : null}
      {!isAdmin && isPaid ? (
        <>
          <span className="text-ink-muted/40">|</span>
          <span className="text-ink-muted">Kuota:</span>
          <span className="font-semibold tabular-nums">
            {remaining} / {monthly_quota}
          </span>
          {plan_expires_at ? (
            <span className="text-xs text-ink-muted">
              (berakhir {new Date(plan_expires_at).toLocaleDateString("id-ID")})
            </span>
          ) : null}
        </>
      ) : null}
      {!isAdmin && !isPaid ? (
        <>
          <span className="text-ink-muted/40">|</span>
          <span className="text-ink-muted">Kredit:</span>
          <span className="font-semibold tabular-nums">{bal}</span>
        </>
      ) : null}
      {!data.emailVerified ? (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
          Email belum terverifikasi
        </span>
      ) : null}
      <Link
        href={isAdmin ? "/dashboard/settings" : isPaid ? "/dashboard/topup" : "/dashboard/upgrade"}
        className="ml-auto text-accent hover:underline"
      >
        {isAdmin ? "Pengaturan" : isPaid ? "Top-up kredit" : "Upgrade paket"}
      </Link>
    </div>
  );
}
