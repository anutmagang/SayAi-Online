"use client";

import { useQuery } from "@tanstack/react-query";

type Summary = {
  jobTotal: number;
  jobCountsByStatus: Record<string, number>;
  viral: {
    avgScore: number | null;
    maxScore: number | null;
    clipsScored: number;
  };
  topupsPending: number;
  credits: { tier: string; balance: number } | null;
};

async function fetchSummary(): Promise<Summary> {
  const res = await fetch("/api/analytics/summary");
  if (!res.ok) throw new Error("Gagal memuat analitik");
  return res.json() as Promise<Summary>;
}

export function AnalyticsClient() {
  const { data, isError, isPending } = useQuery({
    queryKey: ["analytics"],
    queryFn: fetchSummary,
    refetchInterval: 20_000,
  });

  if (isPending) {
    return <p className="text-sm text-ink-muted">Memuat…</p>;
  }
  if (isError || !data) {
    return <p className="text-sm text-red-600">Tidak dapat memuat ringkasan.</p>;
  }

  const statusEntries = Object.entries(data.jobCountsByStatus).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Total job" value={String(data.jobTotal)} />
        <StatCard
          title="Skor viral rata-rata"
          value={
            data.viral.avgScore != null ? String(data.viral.avgScore) : "—"
          }
          subtitle={
            data.viral.clipsScored
              ? `${data.viral.clipsScored} klip · maks ${data.viral.maxScore ?? "—"}`
              : "Belum ada skor (selesaikan job setelah deploy Phase 4 pipeline)"
          }
        />
        <StatCard
          title="Top-up menunggu"
          value={String(data.topupsPending)}
          subtitle="Permintaan pending"
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-ink">Job per status</h2>
        <div className="mt-4 space-y-3">
          {statusEntries.length === 0 ? (
            <p className="text-sm text-ink-muted">Belum ada data.</p>
          ) : (
            statusEntries.map(([k, v]) => (
              <div key={k} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-sm capitalize text-ink-muted">{k}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-subtle">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{
                      width: `${data.jobTotal ? Math.min(100, (v / data.jobTotal) * 100) : 0}%`,
                    }}
                  />
                </div>
                <span className="w-8 text-right text-sm tabular-nums text-ink">{v}</span>
              </div>
            ))
          )}
        </div>
      </section>

      {data.credits ? (
        <section className="rounded-lg border border-edge bg-surface p-4 text-sm">
          <p className="text-ink-muted">Saldo saat ini</p>
          <p className="mt-1 font-medium text-ink">
            Tier <span className="capitalize">{data.credits.tier}</span>
            {data.credits.tier !== "pro" ? (
              <>
                {" "}
                · <span className="tabular-nums">{data.credits.balance}</span> kredit
              </>
            ) : null}
          </p>
        </section>
      ) : null}
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{title}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-ink">{value}</p>
      {subtitle ? <p className="mt-1 text-xs text-ink-muted">{subtitle}</p> : null}
    </div>
  );
}
