"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ClipMeta, JobEventRow, JobResult } from "@/lib/types";

export type JobPayload = {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  job_type?: "clipper" | "image_gen" | "video_gen" | null;
  source_url: string;
  error_message: string | null;
  result: JobResult | null;
  created_at: string;
  updated_at: string;
  finished_at?: string | null;
  tier_used?: "free" | "starter" | "creator" | "pro" | null;
  source_kind?: "url" | "upload" | "ai_image" | "ai_video" | null;
  llm_provider_used?: string | null;
  transcribe_provider_used?: string | null;
  clips_storage_prefix?: string | null;
};

async function fetchJob(id: string): Promise<JobPayload> {
  const res = await fetch(`/api/jobs/${id}`);
  if (!res.ok) throw new Error("Gagal memuat job");
  return res.json() as Promise<JobPayload>;
}

async function fetchEvents(id: string): Promise<JobEventRow[]> {
  const res = await fetch(`/api/jobs/${id}/events`);
  if (!res.ok) return [];
  return res.json() as Promise<JobEventRow[]>;
}

/** Job gagal dari URL YouTube / yt-dlp — tampilkan panduan cookie + alternatif upload. */
function showYoutubeDownloadRecoveryHint(sourceUrl: string, err: string | null): boolean {
  if (!err) return false;
  const u = sourceUrl.toLowerCase();
  if (!u.includes("youtube.com") && !u.includes("youtu.be")) return false;
  const e = err.toLowerCase();
  return (
    e.includes("sign in") ||
    e.includes("not a bot") ||
    e.includes("cookie") ||
    e.includes("authentication") ||
    e.includes("yt-dlp") ||
    e.includes("ytdlp") ||
    e.includes("semua kombinasi") ||
    e.includes("youtube menolak") ||
    e.includes("tidak ada file cookie")
  );
}

function YoutubeDownloadFailedHelp() {
  const wiki =
    "https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies";
  return (
    <div className="rounded-lg border border-amber-200/90 bg-amber-50/90 px-4 py-4 text-sm text-amber-950 shadow-sm">
      <p className="font-semibold text-amber-950">Unduhan YouTube gagal (yt-dlp)</p>
      <p className="mt-2 leading-relaxed text-amber-950/95">
        YouTube sering menolak unduhan dari server tanpa sesi login yang valid, atau cookie Anda
        perlu diperbarui. Pilih salah satu jalur di bawah.
      </p>
      <ol className="mt-3 list-decimal space-y-2.5 pl-5 leading-relaxed text-amber-950/95">
        <li>
          <strong>Perbarui cookie Anda</strong> (disarankan untuk tetap pakai URL YouTube). Buka{" "}
          <Link href="/dashboard/settings" className="font-medium text-accent underline">
            Pengaturan → Cookie YouTube
          </Link>
          , unggah file <span className="font-mono text-xs">cookies.txt</span> format{" "}
          <strong>Netscape</strong> (bukan JSON). Ekspor dari browser saat tab{" "}
          <strong>youtube.com</strong> sudah login dan video ini bisa diputar.
        </li>
        <li>
          <strong>Panduan ekspor resmi yt-dlp</strong> (ekstensi &quot;Get cookies.txt LOCALLY&quot;
          dll.):{" "}
          <a href={wiki} className="font-medium text-accent underline" target="_blank" rel="noreferrer">
            Exporting YouTube cookies
          </a>
          . Setelah unggah, buat <strong>job baru</strong> dengan URL yang sama.
        </li>
        <li>
          <strong>Jalurnya tetap macet?</strong> Gunakan alternatif: unduh videonya di komputer
          atau HP (lewat browser / aplikasi apa pun yang Anda pakai biasanya), lalu di{" "}
          <Link href="/dashboard" className="font-medium text-accent underline">
            dashboard → job baru
          </Link>{" "}
          pilih <strong>Upload file</strong> sebagai sumber. Pipeline klip tetap sama; yang
          dihindari hanya unduhan langsung dari server ke YouTube.
        </li>
      </ol>
      <p className="mt-3 text-xs leading-relaxed text-amber-900/85">
        Admin VPS: file global opsional di{" "}
        <span className="font-mono">secrets/youtube-cookies.txt</span> atau env{" "}
        <span className="font-mono">YTDLP_COOKIES</span>. Cek <span className="font-mono">worker.log</span>{" "}
        untuk baris <span className="font-mono">yt-dlp akan memakai --cookies</span> /{" "}
        <span className="font-mono">YTDLP_COOKIES file=</span>.
      </p>
    </div>
  );
}

export function JobDetail({ jobId, initial }: { jobId: string; initial: JobPayload }) {
  const [job, setJob] = useState(initial);
  const searchParams = useSearchParams();
  const creditBillingHint = searchParams.get("billed") === "credit";

  const refresh = useCallback(async () => {
    try {
      setJob(await fetchJob(jobId));
    } catch {
      // ignore
    }
  }, [jobId]);

  const eventsQ = useQuery({
    queryKey: ["job-events", jobId],
    queryFn: () => fetchEvents(jobId),
    refetchInterval: job.status === "pending" || job.status === "running" ? 2000 : false,
    enabled: job.status !== "failed",
  });

  useEffect(() => {
    if (job.status === "completed" || job.status === "failed") return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [job.status, refresh]);

  const latestEvent = eventsQ.data?.[0];
  const progress = latestEvent?.progress ?? (job.status === "completed" ? 100 : 0);

  const clips = job.result?.clips ?? [];
  const phase3 = job.result?.phase3;
  const generations = job.result?.generations ?? [];
  const isAiJob = (job.job_type === "image_gen" || job.job_type === "video_gen") && generations.length > 0;
  const clipsRequested = job.result?.clips_requested;
  const clipsDelivered = job.result?.clips_delivered ?? clips.length;
  const viralTargetMin = job.result?.viral_score_target_min ?? 85;
  const resultTier = job.result?.user_tier ?? job.tier_used;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/dashboard" className="text-sm font-medium text-accent hover:underline">
          ← Kembali ke dashboard
        </Link>
        <h1 className="mt-4 text-2xl font-semibold text-ink">Detail job</h1>
        <p className="mt-1 truncate text-sm text-accent">{job.source_url}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
          <StatusBadge status={job.status} />
          {job.job_type ? <TypeBadge jobType={job.job_type} /> : null}
          {job.tier_used ? (
            <span className="text-xs">
              Tier saat dibuat: <strong className="text-ink">{job.tier_used}</strong>
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded border border-edge px-2 py-0.5 text-xs hover:bg-subtle"
          >
            Muat ulang
          </button>
        </div>
        {job.error_message ? (
          <div className="mt-4 space-y-3">
            <pre className="max-h-48 overflow-auto rounded-lg bg-red-50 p-4 text-xs text-red-900">
              {job.error_message}
            </pre>
            {showYoutubeDownloadRecoveryHint(job.source_url, job.error_message) ? (
              <YoutubeDownloadFailedHelp />
            ) : null}
          </div>
        ) : null}
        {creditBillingHint ? (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Job ini dikenakan kredit. Cek saldo kredit di dashboard.
          </p>
        ) : null}
      </div>

      {(job.status === "pending" || job.status === "running") && (
        <ProgressPanel progress={progress} events={eventsQ.data ?? []} />
      )}

      {job.status === "completed" && isAiJob ? (
        <section>
          <h2 className="text-lg font-semibold text-ink">Hasil AI generator</h2>
          <AIGeneratedCard
            jobId={jobId}
            generation={generations[0]}
            prompt={job.result?.ai?.prompt}
          />
        </section>
      ) : null}

      {job.status === "completed" && clips.length > 0 ? (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">Pratinjau &amp; unduhan</h2>
            <a
              href={`/api/jobs/${jobId}/zip`}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Unduh semua (ZIP)
            </a>
          </div>
          {clipsRequested != null ? (
            <p className="mt-2 text-sm text-ink-muted">
              <strong className="text-ink">{clipsDelivered}</strong> klip dihasilkan
              {clipsRequested !== clipsDelivered ? (
                <>
                  {" "}
                  (saat membuat job diminta <strong className="text-ink">{clipsRequested}</strong> klip). Lebih
                  sedikit biasanya karena durasi sumber terbatas, tumpang tindih segmen, atau respons model.
                </>
              ) : (
                <> — sesuai jumlah yang diminta.</>
              )}
            </p>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">
              <strong className="text-ink">{clips.length}</strong> klip dalam job ini.
            </p>
          )}
          <p className="mt-1 text-sm text-ink-muted">
            Target skor viral (heuristik, bukan jaminan algoritma):{" "}
            <strong className="text-ink">≥ {viralTargetMin}%</strong> per klip. Skor di bawah itu tetap
            ditampilkan agar Anda bisa menilai potongan tersebut.
          </p>
          {phase3 ? (
            <p className="mt-2 rounded-lg border border-edge/80 bg-canvas/50 px-3 py-2 text-sm text-ink-muted">
              <span className="font-medium text-ink">Output video: </span>
              {phase3.output_layout === "long_horizontal"
                ? "horizontal 16:9."
                : "Shorts/Reels 9:16."}{" "}
              <span className="font-medium text-ink">Watermark file: </span>
              {resultTier === "free" ? (
                <>
                  wajib berwatermark paket Free (
                  <strong className="text-ink">
                    {phase3.watermark_text?.trim()
                      ? `\u201c${phase3.watermark_text}\u201d`
                      : "Fai-Clipper"}
                  </strong>
                  ).
                </>
              ) : phase3.watermark_text?.trim() ? (
                <>
                  berwatermark{" "}
                  <strong className="text-ink">{`\u201c${phase3.watermark_text}\u201d`}</strong> (terbakar di
                  video).
                </>
              ) : (
                <>tanpa watermark teks pada file MP4 (sesuai pengaturan job / akun).</>
              )}
            </p>
          ) : null}
          <ul className="mt-6 grid gap-6 md:grid-cols-2">
            {clips.map((c, index) => (
              <ClipCard
                key={index}
                jobId={jobId}
                index={index}
                clip={c}
                clipOrdinalTotal={clips.length}
                viralTargetMin={viralTargetMin}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function AIGeneratedCard({
  jobId,
  generation,
  prompt,
}: {
  jobId: string;
  generation: NonNullable<JobResult["generations"]>[number] | undefined;
  prompt?: string;
}) {
  if (!generation) return null;
  const src = `/api/jobs/${jobId}/generated`;
  return (
    <div className="mt-4 rounded-xl border border-edge bg-surface p-4 shadow-sm">
      <p className="text-sm font-medium text-ink">Output AI ({generation.kind})</p>
      {prompt ? <p className="mt-1 text-xs text-ink-muted">Prompt: {prompt}</p> : null}
      {generation.kind === "image" ? (
        <img src={src} alt="Generated" className="mt-3 w-full rounded-lg border border-edge object-contain" />
      ) : (
        <video
          className="mt-3 max-h-[min(92vh,960px)] w-full rounded-lg bg-black object-contain"
          controls
          preload="metadata"
          src={src}
        />
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={`${src}?dl=1`}
          className="rounded-md border border-edge bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-subtle"
        >
          Unduh {generation.kind === "image" ? "gambar" : "video"}
        </a>
      </div>
    </div>
  );
}

function ClipCard({
  jobId,
  index,
  clip,
  clipOrdinalTotal,
  viralTargetMin,
}: {
  jobId: string;
  index: number;
  clip: ClipMeta;
  clipOrdinalTotal: number;
  viralTargetMin: number;
}) {
  const clipId = String(index).padStart(2, "0");
  const src = `/api/jobs/${jobId}/clips/${clipId}`;
  const caption = (clip.post_caption ?? "").trim();
  const hashtags = (clip.hashtags ?? "").trim();
  const copyPayload = [caption, hashtags].filter(Boolean).join("\n\n");
  const [copyState, setCopyState] = useState<"idle" | "ok" | "err">("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viral = clip.viral_score;
  const belowViral = viral != null && viral < viralTargetMin;

  async function copyCaptionBlock() {
    if (!copyPayload) return;
    try {
      await navigator.clipboard.writeText(copyPayload);
      setCopyState("ok");
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("err");
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopyState("idle"), 2500);
    }
  }

  return (
    <li className="rounded-xl border border-edge bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink">
          Klip {index + 1} dari {clipOrdinalTotal}{" "}
          <span className="font-normal text-ink-muted">
            ({clip.start_sec.toFixed(1)}s - {clip.end_sec.toFixed(1)}s)
          </span>
        </p>
        <div className="flex flex-wrap justify-end gap-1.5">
          {clip.watermarked === true ? (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-800">
              Berwatermark
            </span>
          ) : clip.watermarked === false ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900">
              Tanpa watermark
            </span>
          ) : null}
        </div>
      </div>
      {viral != null ? (
        <p
          className={`mt-1 text-xs font-medium tabular-nums ${
            belowViral ? "text-amber-800" : "text-emerald-800"
          }`}
        >
          Skor viral (heuristik): {viral.toFixed(0)}%
          {belowViral ? ` — di bawah target ${viralTargetMin}%` : ` — ≥ target ${viralTargetMin}%`}
        </p>
      ) : null}
      {clip.label ? <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{clip.label}</p> : null}
      {caption || hashtags ? (
        <div className="mt-3 space-y-2 rounded-lg border border-edge/80 bg-canvas/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Caption &amp; hashtag (SEO)
            </p>
            {copyPayload ? (
              <button
                type="button"
                onClick={() => void copyCaptionBlock()}
                className="rounded-md border border-edge bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:bg-subtle"
              >
                {copyState === "ok" ? "Tersalin" : copyState === "err" ? "Gagal salin" : "Salin semua"}
              </button>
            ) : null}
          </div>
          {caption ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{caption}</p>
          ) : (
            <p className="text-xs italic text-ink-muted">Tidak ada caption dari model.</p>
          )}
          {hashtags ? (
            <p className="break-words text-sm text-accent">{hashtags}</p>
          ) : caption ? (
            <p className="text-xs italic text-ink-muted">Tidak ada hashtag dari model.</p>
          ) : null}
        </div>
      ) : null}
      <video
        className="mt-3 max-h-[min(92vh,960px)] w-full rounded-lg bg-black object-contain"
        controls
        preload="metadata"
        src={src}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={`${src}?dl=1`}
          className="rounded-md border border-edge bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-subtle"
        >
          Unduh MP4
        </a>
      </div>
    </li>
  );
}

function ProgressPanel({
  progress,
  events,
}: {
  progress: number;
  events: JobEventRow[];
}) {
  const latest = events[0];
  return (
    <section className="rounded-xl border border-edge bg-surface p-5 shadow-sm">
      <p className="text-sm font-medium text-ink">Progress</p>
      <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-subtle">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${Math.min(100, Math.max(2, progress))}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-ink-muted tabular-nums">{Math.round(progress)}%</p>
      {latest?.message ? (
        <div className="mt-4 rounded-lg border border-edge bg-canvas/80 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            Aktivitas terakhir
          </p>
          <p className="mt-1 text-sm leading-snug text-ink">{latest.message}</p>
          <p className="mt-1.5 text-[10px] text-ink-muted">
            {latest.phase} · {new Date(latest.created_at).toLocaleString("id-ID")} · diperbarui tiap
            ~2 detik
          </p>
        </div>
      ) : null}
      {events.length > 0 ? (
        <ul className="mt-4 space-y-1 text-xs text-ink-muted">
          {events.slice(0, 12).map((e) => (
            <li key={e.id} className="flex gap-2">
              <span className="font-mono text-[10px] text-ink-muted">
                {new Date(e.created_at).toLocaleTimeString("id-ID")}
              </span>
              <span className="font-medium capitalize text-ink">{e.phase}</span>
              {e.message ? <span>- {e.message}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-ink-muted">Menunggu update dari worker...</p>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-amber-100 text-amber-900",
    running: "bg-blue-100 text-blue-900",
    completed: "bg-emerald-100 text-emerald-900",
    failed: "bg-red-100 text-red-900",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? "bg-subtle"}`}
    >
      {status}
    </span>
  );
}

function TypeBadge({ jobType }: { jobType: NonNullable<JobPayload["job_type"]> }) {
  const map: Record<string, string> = {
    clipper: "Clipper",
    image_gen: "AI Image",
    video_gen: "AI Video",
  };
  return <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-900">{map[jobType] ?? jobType}</span>;
}
