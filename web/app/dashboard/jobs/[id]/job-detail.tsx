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
    refetchInterval: job.status === "pending" || job.status === "running" ? 3000 : false,
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
          <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-red-50 p-4 text-xs text-red-900">
            {job.error_message}
          </pre>
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
          {phase3 ? (
            <p className="mt-2 text-sm text-ink-muted">
              {phase3.output_layout === "long_horizontal"
                ? "Output: konten horizontal 16:9."
                : "Output: Shorts/Reels 9:16."}
              {phase3.watermark_text
                ? ` Watermark: \"${phase3.watermark_text}\".`
                : " Tanpa watermark."}
            </p>
          ) : null}
          <ul className="mt-6 grid gap-6 md:grid-cols-2">
            {clips.map((c, index) => (
              <ClipCard key={index} jobId={jobId} index={index} clip={c} />
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
}: {
  jobId: string;
  index: number;
  clip: ClipMeta;
}) {
  const clipId = String(index).padStart(2, "0");
  const src = `/api/jobs/${jobId}/clips/${clipId}`;
  const caption = (clip.post_caption ?? "").trim();
  const hashtags = (clip.hashtags ?? "").trim();
  const copyPayload = [caption, hashtags].filter(Boolean).join("\n\n");
  const [copyState, setCopyState] = useState<"idle" | "ok" | "err">("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      <p className="text-sm font-medium text-ink">
        Klip {index + 1}{" "}
        <span className="font-normal text-ink-muted">
          ({clip.start_sec.toFixed(1)}s - {clip.end_sec.toFixed(1)}s)
        </span>
      </p>
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
      {events.length > 0 ? (
        <ul className="mt-4 space-y-1 text-xs text-ink-muted">
          {events.slice(0, 8).map((e) => (
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
