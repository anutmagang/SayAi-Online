"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { JobRow } from "@/lib/types";

async function fetchJobs(): Promise<JobRow[]> {
  const res = await fetch("/api/jobs");
  if (!res.ok) {
    throw new Error("Gagal memuat job");
  }
  return res.json() as Promise<JobRow[]>;
}

export function JobsList({ initialJobs }: { initialJobs: JobRow[] }) {
  const { data: jobs = initialJobs, isError } = useQuery({
    queryKey: ["jobs"],
    queryFn: fetchJobs,
    initialData: initialJobs,
    refetchInterval: 10_000,
  });

  if (isError) {
    return (
      <p className="mt-3 text-sm text-red-600">Tidak dapat memuat riwayat job.</p>
    );
  }

  if (!jobs.length) {
    return <p className="mt-3 text-sm text-ink-muted">Belum ada job.</p>;
  }

  return (
    <ul className="mt-4 divide-y divide-edge rounded-xl border border-edge bg-surface">
      {jobs.map((job) => (
        <li key={job.id}>
          <Link
            href={`/dashboard/jobs/${job.id}`}
            className="flex flex-col gap-1 px-4 py-3 transition hover:bg-accent-soft/40 sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="truncate text-sm font-medium text-accent">
              {job.source_url}
            </span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-ink-muted">
              {job.job_type ? <TypeBadge jobType={job.job_type} /> : null}
              <StatusBadge status={job.status} />
              <time dateTime={job.created_at}>
                {new Date(job.created_at).toLocaleString("id-ID")}
              </time>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function TypeBadge({ jobType }: { jobType: NonNullable<JobRow["job_type"]> }) {
  const map: Record<string, { label: string; cls: string }> = {
    clipper: { label: "Clipper", cls: "bg-purple-100 text-purple-900" },
    image_gen: { label: "AI Image", cls: "bg-sky-100 text-sky-900" },
    video_gen: { label: "AI Video", cls: "bg-indigo-100 text-indigo-900" },
  };
  const cur = map[jobType] ?? { label: jobType, cls: "bg-subtle text-ink" };
  return <span className={`rounded-full px-2 py-0.5 font-medium ${cur.cls}`}>{cur.label}</span>;
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
      className={`rounded-full px-2 py-0.5 font-medium ${colors[status] ?? "bg-subtle text-ink"}`}
    >
      {status}
    </span>
  );
}
