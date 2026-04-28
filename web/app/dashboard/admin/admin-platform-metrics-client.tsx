"use client";

import { useQuery } from "@tanstack/react-query";

type Metrics = {
  users_total: number;
  jobs_created_24h: number;
  jobs_created_7d: number;
  storage_latest: {
    taken_at: string;
    total_bytes: number;
    storage_cost_usd_est: number | null;
    worker_disk_bytes_est: number | null;
  } | null;
  llm_pool: Record<string, { enabled: number; healthy: number; other: number }>;
  note?: string;
};

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

async function fetchMetrics(): Promise<Metrics> {
  const res = await fetch("/api/admin/platform-metrics");
  if (res.status === 403) throw new Error("forbidden");
  if (!res.ok) throw new Error("fetch");
  return res.json() as Promise<Metrics>;
}

export function AdminPlatformMetricsClient() {
  const q = useQuery({
    queryKey: ["admin-platform-metrics"],
    queryFn: fetchMetrics,
    retry: false,
    refetchInterval: 20_000,
  });

  if (q.isError && (q.error as Error)?.message === "forbidden") {
    return <p className="text-sm text-red-600">Akses admin diperlukan.</p>;
  }

  if (q.isPending) {
    return <p className="text-sm text-ink-muted">Memuat ringkasan platform…</p>;
  }

  if (q.isError || !q.data) {
    return <p className="text-sm text-red-600">Gagal memuat metrik.</p>;
  }

  const m = q.data;
  const snap = m.storage_latest;

  return (
    <div className="space-y-4">
      {m.note ? <p className="text-xs text-ink-muted">{m.note}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-edge bg-surface px-4 py-3 text-sm">
          <p className="text-ink-muted">Pengguna (profil)</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{m.users_total}</p>
        </div>
        <div className="rounded-lg border border-edge bg-surface px-4 py-3 text-sm">
          <p className="text-ink-muted">Job dibuat (24 jam)</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{m.jobs_created_24h}</p>
        </div>
        <div className="rounded-lg border border-edge bg-surface px-4 py-3 text-sm">
          <p className="text-ink-muted">Job dibuat (7 hari)</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{m.jobs_created_7d}</p>
        </div>
        <div className="rounded-lg border border-edge bg-surface px-4 py-3 text-sm">
          <p className="text-ink-muted">Storage terbaru</p>
          <p className="mt-1 text-lg font-semibold text-ink">
            {snap ? fmtBytes(snap.total_bytes) : "—"}
          </p>
          {snap?.storage_cost_usd_est != null ? (
            <p className="text-xs text-ink-muted">
              Perkiraan biaya storage: ~${Number(snap.storage_cost_usd_est).toFixed(4)} / snapshot
            </p>
          ) : null}
          {snap?.worker_disk_bytes_est != null ? (
            <p className="text-xs text-ink-muted">
              Estimasi disk worker: {fmtBytes(snap.worker_disk_bytes_est)} (env WORKER_DISK_USAGE_BYTES)
            </p>
          ) : null}
          {snap?.taken_at ? (
            <p className="mt-1 text-[11px] text-ink-muted">Diambil: {snap.taken_at}</p>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-edge bg-subtle/50 px-4 py-3 text-sm">
        <p className="font-medium text-ink">Ringkasan pool key (tanpa detail key)</p>
        <ul className="mt-2 space-y-1 text-xs text-ink-muted">
          {Object.entries(m.llm_pool).map(([prov, c]) => (
            <li key={prov}>
              <span className="font-mono uppercase">{prov}</span>: {c.enabled} aktif —{" "}
              <span className="text-emerald-800">{c.healthy} sehat</span>
              {c.other > 0 ? (
                <span className="text-amber-900">, {c.other} non-sehat / cooldown</span>
              ) : null}
            </li>
          ))}
          {Object.keys(m.llm_pool).length === 0 ? <li>Belum ada baris pool.</li> : null}
        </ul>
      </div>
    </div>
  );
}
