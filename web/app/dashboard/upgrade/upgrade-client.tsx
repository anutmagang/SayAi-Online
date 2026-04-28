"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  canRequestSubscriptionTier,
  selectablePaidTiers,
  tierRank,
  type PaidTier,
} from "@/lib/subscription-tier";
import { subscriptionApprovalBonusCredits } from "@/lib/credits-pricing";
import { TIER_DETAILS, formatIdr, type Tier } from "@/lib/tiers";

type Req = {
  id: string;
  requested_tier: Tier;
  months: number;
  status: "pending" | "approved" | "rejected";
  payment_note: string | null;
  bank_reference: string | null;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
};

function defaultUpgradeTier(current: Tier, planExpiresAt: string | null): PaidTier {
  const sel = selectablePaidTiers(current, planExpiresAt);
  if (!sel.length) return "pro";
  const cur = tierRank(current);
  const stepUp = sel
    .filter((t) => tierRank(t) > cur)
    .sort((a, b) => tierRank(a) - tierRank(b))[0];
  return stepUp ?? sel[sel.length - 1]!;
}

export function UpgradeClient({
  currentTier,
  planExpiresAt,
  requests,
}: {
  currentTier: Tier;
  planExpiresAt: string | null;
  requests: Req[];
}) {
  const qc = useQueryClient();
  const allowed = useMemo(
    () => selectablePaidTiers(currentTier, planExpiresAt),
    [currentTier, planExpiresAt],
  );
  const initialTier = useMemo(
    () => defaultUpgradeTier(currentTier, planExpiresAt),
    [currentTier, planExpiresAt],
  );
  const [tier, setTier] = useState<PaidTier>(initialTier);
  const [months, setMonths] = useState(1);
  const [bankRef, setBankRef] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const next = defaultUpgradeTier(currentTier, planExpiresAt);
    setTier((prev) => (allowed.includes(prev) ? prev : next));
  }, [currentTier, planExpiresAt, allowed]);

  const mutation = useMutation({
    mutationFn: async () => {
      setErr(null);
      if (!allowed.length) {
        throw new Error("Tidak ada paket yang bisa diajukan saat ini.");
      }
      const gate = canRequestSubscriptionTier(currentTier, tier, planExpiresAt);
      if (!gate.ok) throw new Error(gate.reason ?? "Paket tidak diizinkan");
      if (paymentNote.trim().length < 8) {
        throw new Error(
          "Catatan pembayaran minimal 8 karakter — cantumkan metode & nominal transfer.",
        );
      }
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier,
          months,
          paymentNote: paymentNote.trim(),
          bankReference: bankRef.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Gagal mengirim permintaan");
    },
    onSuccess: () => {
      setBankRef("");
      setPaymentNote("");
      void qc.invalidateQueries({ queryKey: ["me"] });
      window.location.reload();
    },
    onError: (e: unknown) => {
      setErr(e instanceof Error ? e.message : "Terjadi kesalahan");
    },
  });

  const totalIdr = TIER_DETAILS[tier].priceIdr * months;
  const canSubmit = allowed.length > 0;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold text-ink">Upgrade paket</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Paket saat ini: <strong>{TIER_DETAILS[currentTier].label}</strong>
          {planExpiresAt
            ? ` · aktif sampai ${new Date(planExpiresAt).toLocaleDateString("id-ID")}`
            : ""}
        </p>
        {!canSubmit ? (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-ink">
            Anda sudah berlangganan paket tertinggi yang tersedia, atau paket aktif belum
            berakhir sehingga tidak ada upgrade baru yang bisa diajukan dari halaman ini.
            Setelah masa aktif berakhir, Anda bisa memperpanjang tier yang sama atau
            menghubungi admin.
          </p>
        ) : null}
        <div className="mt-4 rounded-xl border border-edge bg-subtle p-4 text-sm text-ink-muted">
          <p className="font-medium text-ink">Kredit vs kuota bulanan</p>
          <p className="mt-1 leading-relaxed">
            Di <strong>Free</strong>, tiap job memakai <strong>kredit</strong> dari saldo.
            Setelah langganan <strong>Starter / Creator / Pro</strong> disetujui admin,
            pemakaian utama berpindah ke <strong>kuota bulanan</strong> (job per bulan
            sesuai paket). Pada saat itu Anda juga mendapat{" "}
            <strong>bonus kredit sekali</strong>: Starter +{subscriptionApprovalBonusCredits("starter")},{" "}
            Creator +{subscriptionApprovalBonusCredits("creator")}, Pro +
            {subscriptionApprovalBonusCredits("pro")} — untuk cadangan bila kuota habis
            (1 job = 1 kredit). Sisa kredit lama tetap di profil.
          </p>
          {currentTier !== "free" ? (
            <p className="mt-2 text-xs text-ink-muted">
              Selama paket berbayar masih aktif, Anda hanya bisa mengajukan tier yang{" "}
              <strong className="text-ink">lebih tinggi</strong> dari sekarang (tidak bisa
              memperpanjang tier yang sama di sini, dan tidak ada downgrade).
            </p>
          ) : null}
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        {(["starter", "creator", "pro"] as const).map((t) => {
          const d = TIER_DETAILS[t];
          const gate = canRequestSubscriptionTier(currentTier, t, planExpiresAt);
          const isCurrent = currentTier === t;
          const selected = tier === t;
          return (
            <button
              key={t}
              type="button"
              disabled={!gate.ok}
              title={!gate.ok ? gate.reason : undefined}
              onClick={() => {
                if (gate.ok) setTier(t);
              }}
              className={`flex flex-col rounded-2xl border p-5 text-left transition ${
                selected && gate.ok
                  ? "border-accent bg-accent-soft ring-2 ring-accent/30"
                  : "border-edge bg-surface hover:border-edge"
              } ${!gate.ok ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="text-lg font-semibold text-ink">{d.label}</span>
                <div className="flex flex-col items-end gap-1 text-right">
                  {isCurrent ? (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                      Paket saat ini
                    </span>
                  ) : null}
                  <span className="font-medium text-ink">{formatIdr(d.priceIdr)}/bln</span>
                </div>
              </div>
              <p className="mt-1 text-sm text-ink-muted">{d.llmDescription}</p>
              <ul className="mt-3 space-y-1 text-sm text-ink-muted">
                <li>• {d.monthlyQuota} job / bulan (kuota)</li>
                {d.bonusCreditsOnSubscription != null ? (
                  <li className="font-medium text-emerald-800">
                    • +{d.bonusCreditsOnSubscription} kredit bonus sekali saat disetujui
                  </li>
                ) : null}
                {d.features.slice(0, 3).map((f) => (
                  <li key={f}>• {f}</li>
                ))}
              </ul>
              {!gate.ok ? (
                <p className="mt-3 text-[11px] leading-snug text-amber-900/90">{gate.reason}</p>
              ) : null}
            </button>
          );
        })}
      </section>

      <Card>
        <h2 className="text-lg font-semibold text-ink">Ajukan upgrade</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Transfer manual ke rekening yang tertera di email konfirmasi, lalu kirim
          permintaan di sini. Admin biasanya aktifkan akun Anda dalam 1×24 jam.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) mutation.mutate();
          }}
          className="mt-4 flex flex-col gap-4"
        >
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[140px]">
              <Label htmlFor="months">Durasi (bulan)</Label>
              <Input
                id="months"
                type="number"
                min={1}
                max={24}
                value={months}
                disabled={!canSubmit}
                onChange={(e) =>
                  setMonths(Math.max(1, Math.min(24, Number(e.target.value) || 1)))
                }
              />
            </div>
            <div className="flex flex-col justify-end text-sm text-ink-muted">
              Total: <strong className="text-ink">{formatIdr(totalIdr)}</strong>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="payment-note">Catatan pembayaran (wajib, min 8 karakter)</Label>
            <textarea
              id="payment-note"
              className="min-h-[80px] rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-ink"
              placeholder="Contoh: Transfer BCA 335.000 tanggal 24/04/2026 a.n. Budi — upgrade Pro 1 bulan."
              value={paymentNote}
              disabled={!canSubmit}
              onChange={(e) => setPaymentNote(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bank-ref">No. referensi / link bukti (opsional)</Label>
            <Input
              id="bank-ref"
              placeholder="mis. BCA 20260101-123456 atau URL Google Drive"
              value={bankRef}
              disabled={!canSubmit}
              onChange={(e) => setBankRef(e.target.value)}
            />
          </div>
          {err ? <p className="text-sm text-red-600">{err}</p> : null}
          <Button
            type="submit"
            variant="primary"
            disabled={mutation.isPending || !canSubmit}
            className="self-start"
          >
            {mutation.isPending
              ? "Mengirim…"
              : `Ajukan ${TIER_DETAILS[tier].label} · ${months} bln`}
          </Button>
        </form>
      </Card>

      <section>
        <h2 className="text-lg font-semibold text-ink">Riwayat permintaan</h2>
        {requests.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Belum ada permintaan upgrade.</p>
        ) : (
          <ul className="mt-3 divide-y divide-edge rounded-xl border border-edge bg-surface">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink">
                    → {TIER_DETAILS[r.requested_tier]?.label ?? r.requested_tier}
                    <span className="ml-2 text-xs text-ink-muted">{r.months} bln</span>
                  </span>
                  <StatusBadge status={r.status} />
                </div>
                <p className="text-xs text-ink-muted">
                  Dibuat {new Date(r.created_at).toLocaleString("id-ID")}
                  {r.reviewed_at
                    ? ` · diputuskan ${new Date(r.reviewed_at).toLocaleString("id-ID")}`
                    : ""}
                </p>
                {r.admin_note ? (
                  <p className="text-xs text-ink">Catatan admin: {r.admin_note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-amber-100 text-amber-900",
    approved: "bg-emerald-100 text-emerald-900",
    rejected: "bg-red-100 text-red-900",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? "bg-subtle text-ink"}`}
    >
      {status}
    </span>
  );
}
