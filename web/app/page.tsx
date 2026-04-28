import Link from "next/link";
import { redirect } from "next/navigation";
import { SocialLinks } from "@/components/social-links";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { createClient } from "@/lib/supabase/server";
import { subscriptionBonusApproxValueIdr } from "@/lib/credits-pricing";
import { TIER_DETAILS, formatIdr, maxClipsAllowedForTier } from "@/lib/tiers";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="relative min-h-screen bg-canvas text-ink">
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-b from-accent-soft/30 to-transparent" />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-5 sm:px-6">
        <span className="text-lg font-semibold tracking-tight">Fai-Clipper</span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ThemeSwitcher compact />
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/pricing"
              className="rounded-lg px-3 py-2 text-ink-muted transition hover:bg-subtle hover:text-ink"
            >
              Harga
            </Link>
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-ink-muted transition hover:bg-subtle hover:text-ink"
            >
              Masuk
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-accent px-4 py-2 font-medium text-white shadow-lg shadow-black/10 transition hover:opacity-95"
            >
              Mulai gratis
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-5 pb-24 pt-6 sm:px-6 sm:pt-10">
        <div className="grid gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-edge bg-surface/70 px-3 py-1 text-xs font-medium uppercase tracking-wider text-accent">
              AI + FFmpeg · siap sosmed
            </p>
            <h1 className="mt-6 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-[3.25rem]">
              Dari video panjang ke{" "}
              <span className="bg-gradient-to-r from-accent to-indigo-400 bg-clip-text text-transparent">
                klip vertikal
              </span>{" "}
              dalam hitungan menit.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-muted">
              Tempel URL YouTube atau unggah file. AI memilih momen terbaik, memotong 9:16
              dengan face tracking, menambah karaoke caption per kata, dan Anda mengunduh
              MP4 siap upload ke TikTok, Reels, atau Shorts.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center rounded-xl bg-accent px-7 py-3 text-sm font-semibold text-white shadow-xl shadow-black/15 transition hover:opacity-95"
              >
                Daftar — 5 kredit gratis
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center rounded-xl border border-edge bg-surface/80 px-7 py-3 text-sm font-semibold text-ink backdrop-blur transition hover:bg-subtle"
              >
                Lihat paket & kuota
              </Link>
            </div>
            <dl className="mt-12 grid grid-cols-2 gap-6 border-t border-edge pt-10 sm:grid-cols-4">
              <Stat label="Transkrip" value="Groq Whisper" hint="Sangat cepat" />
              <Stat label="LLM free" value="Gemini → Groq" hint="Fallback otomatis" />
              <Stat label="Format" value="9:16 + ASS" hint="Caption karaoke" />
              <Stat label="Unduhan" value="MP4 + ZIP" hint="Per klip / sekaligus" />
            </dl>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-accent/20 via-transparent to-accent-soft/30 blur-2xl" />
            <div className="relative overflow-hidden rounded-2xl border border-edge bg-surface/90 p-6 shadow-2xl backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">
                Alur singkat
              </p>
              <ol className="mt-5 space-y-4 text-sm text-ink">
                <Step n={1} title="Sumber" body="YouTube (URL) atau upload file ke storage aman." />
                <Step n={2} title="AI + timeline" body="Transkrip + pilih highlight + caption & hashtag." />
                <Step n={3} title="Render" body="FFmpeg: crop vertikal, skor viral heuristik, watermark sesuai tier." />
                <Step n={4} title="Ambil hasil" body="Pratinjau di dashboard, unduh per klip atau ZIP." />
              </ol>
              <p className="mt-6 rounded-lg bg-black/30 px-3 py-2 text-xs text-slate-400">
                Data job & file hasil mengikuti kebijakan retensi server (default 10 hari).
                Upgrade untuk kuota bulanan dan penyedia AI tambahan.
              </p>
            </div>
          </div>
        </div>

        <section className="mt-24 border-t border-edge pt-16">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Paket singkat</h2>
              <p className="mt-2 max-w-xl text-sm text-ink-muted">
                Kuota bulanan untuk berlangganan; kredit untuk paket Free & cadangan. Maks
                klip per job bervariasi per tier (hemat biaya AI).
              </p>
            </div>
            <Link href="/pricing" className="text-sm font-medium text-accent hover:underline">
              Detail lengkap →
            </Link>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(["free", "starter", "creator", "pro"] as const).map((t) => {
              const d = TIER_DETAILS[t];
              const mc = maxClipsAllowedForTier(t);
              return (
                <div
                  key={t}
                  className="flex flex-col rounded-2xl border border-edge bg-surface/70 p-5 shadow-sm transition hover:border-accent/40 hover:bg-surface"
                >
                  <h3 className="text-lg font-semibold">{d.label}</h3>
                  <p className="mt-1 text-2xl font-semibold text-ink">
                    {t === "free" ? "Gratis" : formatIdr(d.priceIdr)}
                    {t !== "free" ? <span className="text-sm font-normal text-ink-muted">/bln</span> : null}
                  </p>
                  <p className="mt-2 text-xs text-ink-muted">
                    {t === "free"
                      ? "Bayar per kredit —"
                      : `${d.monthlyQuota} slot job / bulan —`}{" "}
                    hingga {mc} klip / job
                  </p>
                  {t !== "free" && d.bonusCreditsOnSubscription != null ? (
                    <p className="mt-1.5 text-[11px] font-medium text-emerald-600">
                      +{d.bonusCreditsOnSubscription} kredit bonus sekali saat disetujui (~
                      {formatIdr(subscriptionBonusApproxValueIdr(t))} setara top-up)
                    </p>
                  ) : null}
                  <ul className="mt-4 flex-1 space-y-2 text-xs text-ink-muted">
                    {d.features.slice(0, 3).map((f) => (
                      <li key={f} className="flex gap-2">
                        <span className="text-accent">✓</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={t === "free" ? "/signup" : "/dashboard/upgrade"}
                    className="mt-5 inline-flex justify-center rounded-lg border border-edge bg-subtle py-2 text-xs font-semibold text-ink hover:bg-surface"
                  >
                    {t === "free" ? "Daftar" : "Ajukan"}
                  </Link>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-20 rounded-2xl border border-edge bg-gradient-to-br from-accent-soft/40 to-canvas p-8 sm:p-10">
          <h2 className="text-xl font-semibold">Siapa pun bisa mulai</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Tanpa integrasi OAuth ke TikTok atau Meta — Anda mendapat file MP4 bersih,
            lalu upload manual ke platform pilihan. Cocok untuk kreator, podcaster, dan tim
            konten yang ingin pipeline otomatis tanpa vendor lock-in.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:opacity-95"
            >
              Buat akun gratis
            </Link>
            <Link
              href="/legal/terms"
              className="rounded-lg border border-edge bg-surface/60 px-5 py-2.5 text-sm font-medium text-ink hover:bg-subtle"
            >
              Syarat layanan
            </Link>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-edge bg-surface/40">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-8 text-xs text-ink-muted sm:px-6 md:flex-row md:flex-wrap md:items-start md:justify-between">
          <div className="flex flex-col gap-3">
            <span>© {new Date().getFullYear()} Fai-Clipper</span>
            <SocialLinks iconClassName="h-4 w-4" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <ThemeSwitcher className="sm:hidden" />
            <Link href="/pricing" className="hover:text-ink">
              Harga
            </Link>
            <Link href="/legal/terms" className="hover:text-ink">
              Syarat
            </Link>
            <Link href="/legal/privacy" className="hover:text-ink">
              Privasi
            </Link>
            <Link href="/login" className="hover:text-ink">
              Masuk
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-ink">{value}</dd>
      <p className="mt-0.5 text-[11px] text-ink-muted">{hint}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft/50 text-xs font-bold text-accent">
        {n}
      </span>
      <div>
        <p className="font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-ink-muted">{body}</p>
      </div>
    </li>
  );
}
