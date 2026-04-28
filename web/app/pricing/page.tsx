import Link from "next/link";
import { MarketingShell } from "@/components/marketing-shell";
import {
  formatCreditTopupUnitPrice,
  subscriptionApprovalBonusCredits,
  subscriptionBonusApproxValueIdr,
} from "@/lib/credits-pricing";
import { TIER_DETAILS, formatIdr } from "@/lib/tiers";

export const metadata = {
  title: "Harga — Fai-Clipper",
};

export default function PricingPage() {
  return (
    <MarketingShell>
      <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        Paket &amp; harga
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
        Bayar per bulan, dapat kuota job tetap. Paket berbayar mendapat{" "}
        <strong className="text-ink">bonus kredit sekali</strong> saat admin menyetujui
        pembayaran — cadangan jika kuota bulanan habis (1 job = 1 kredit). Top-up manual
        mengikuti harga referensi per kredit.
      </p>

      <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        {(["free", "starter", "creator", "pro"] as const).map((t) => {
          const d = TIER_DETAILS[t];
          const highlight = t === "creator";
          const bonus =
            t !== "free" && d.bonusCreditsOnSubscription != null
              ? subscriptionApprovalBonusCredits(t)
              : 0;
          const bonusVal = t !== "free" ? subscriptionBonusApproxValueIdr(t) : 0;
          return (
            <div
              key={t}
              className={`flex flex-col rounded-2xl border p-6 shadow-sm backdrop-blur transition ${
                highlight
                  ? "border-accent/50 bg-accent-soft/25 shadow-md"
                  : "border-edge bg-surface/80 hover:border-accent/30 hover:bg-surface"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-xl font-semibold text-ink">{d.label}</h2>
                <span className="shrink-0 text-sm font-medium text-ink-muted">
                  {t === "free" ? "Gratis" : `${formatIdr(d.priceIdr)}/bln`}
                </span>
              </div>
              <p className="mt-2 text-sm text-ink-muted">{d.llmDescription}</p>
              {t !== "free" ? (
                <p className="mt-3 rounded-lg border border-emerald-600/25 bg-emerald-600/10 px-3 py-2 text-xs font-medium text-emerald-900">
                  Bonus sekali saat disetujui: <strong className="text-ink">+{bonus} kredit</strong>
                  <span className="text-emerald-800/90">
                    {" "}
                    (~{formatIdr(bonusVal)} setara top-up)
                  </span>
                </p>
              ) : null}
              <p className="mt-4 text-sm font-medium text-ink">
                {t === "free" ? "5 kredit onboarding" : `${d.monthlyQuota} job / bulan (kuota)`}
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-ink-muted">
                {d.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="mt-0.5 shrink-0 text-accent">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={t === "free" ? "/signup" : "/dashboard/upgrade"}
                className={`mt-6 inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                  highlight
                    ? "bg-accent text-white shadow-lg shadow-black/10 hover:opacity-95"
                    : "border border-edge bg-subtle text-ink hover:bg-surface"
                }`}
              >
                {t === "free" ? "Daftar gratis" : `Ajukan ${d.label}`}
              </Link>
            </div>
          );
        })}
      </div>

      <section className="mt-14 rounded-2xl border border-edge bg-surface/70 p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-ink">FAQ singkat</h2>
        <dl className="mt-5 space-y-5 text-sm text-ink-muted">
          <div>
            <dt className="font-medium text-ink">Apa bedanya tier LLM?</dt>
            <dd className="mt-1 leading-relaxed">
              Kualitas pemilihan momen makin baik di model yang lebih mahal. Llama 70B
              sudah cukup untuk banyak kasus; Claude / GPT-4o menangkap konteks &amp;
              humor yang lebih halus.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Kuota bulanan &amp; bonus kredit?</dt>
            <dd className="mt-1 leading-relaxed">
              Untuk paket berbayar, <strong className="text-ink">kuota job</strong> (mis.
              30/bulan) di-reset tiap siklus ~30 hari. Sisa slot bulan lalu{" "}
              <strong className="text-ink">tidak diakumulasi</strong>. Saat langganan{" "}
              <strong className="text-ink">disetujui</strong>, saldo Anda mendapat bonus
              kredit sekali: Starter +12, Creator +30, Pro +52 — angka ini selaras dengan
              backend. Jika kuota bulanan habis tetapi masih ada kredit, tiap job memakai 1
              kredit seperti di Free.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">
              Kalau kuota bulanan sudah penuh tapi saya masih ingin jalanin job?
            </dt>
            <dd className="mt-1 leading-relaxed">
              Jika masih ada <strong className="text-ink">saldo kredit</strong>, sistem
              memakai <strong className="text-ink">1 kredit per job</strong> sebagai
              cadangan. Jika kredit juga habis, top-up atau tunggu reset kuota / perpanjang
              langganan.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Berapa harga 1 kredit top-up?</dt>
            <dd className="mt-1 leading-relaxed">
              Harga referensi:{" "}
              <strong className="text-ink">{formatCreditTopupUnitPrice()}</strong>. Nilai
              &quot;~setara top-up&quot; pada bonus mengikuti harga ini. Paket{" "}
              <strong className="text-ink">Free</strong> juga boleh mengajukan top-up.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Data saya disimpan berapa lama?</dt>
            <dd className="mt-1 leading-relaxed">
              Source video &amp; hasil klip mengikuti retensi server (default{" "}
              <strong className="text-ink">10 hari</strong> lewat job purge). Unduh ZIP/MP4
              sebelum jadwal pembersihan.
            </dd>
          </div>
        </dl>
      </section>
    </MarketingShell>
  );
}
