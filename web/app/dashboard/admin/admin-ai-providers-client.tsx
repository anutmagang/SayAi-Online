"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

type Row = {
  provider: string;
  enabled: boolean;
  priority: number;
  updated_at: string;
};

async function fetchRows(): Promise<Row[]> {
  const res = await fetch("/api/admin/ai-provider-config");
  if (res.status === 403) throw new Error("forbidden");
  if (!res.ok) throw new Error("fetch");
  return res.json() as Promise<Row[]>;
}

async function saveRow(payload: Pick<Row, "provider" | "enabled" | "priority">) {
  const res = await fetch("/api/admin/ai-provider-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || "Gagal menyimpan provider");
  }
}

export function AdminAIProvidersClient() {
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["admin-ai-provider-config"],
    queryFn: fetchRows,
    retry: false,
  });

  const mut = useMutation({
    mutationFn: saveRow,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-ai-provider-config"] }),
  });

  if (q.isError && (q.error as Error)?.message === "forbidden") {
    return <p className="text-sm text-red-600">Akses admin diperlukan.</p>;
  }
  if (q.isPending) {
    return <p className="text-sm text-ink-muted">Memuat konfigurasi provider AI…</p>;
  }
  if (q.isError || !q.data) {
    return <p className="text-sm text-red-600">Gagal memuat konfigurasi provider AI.</p>;
  }

  const rows = q.data;

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        Urutan priority kecil lebih dulu. Worker AI akan fallback ke provider berikutnya jika
        provider pertama gagal / rate limit.
      </p>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.provider} className="rounded-lg border border-edge bg-surface p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-ink">{r.provider}</p>
              <div className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) =>
                      mut.mutate({ provider: r.provider, enabled: e.target.checked, priority: r.priority })
                    }
                  />
                  aktif
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-xs text-ink-muted">priority</span>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    defaultValue={r.priority}
                    className="h-8 w-20 rounded border border-edge bg-surface px-2 text-xs"
                    onBlur={(e) => {
                      const val = Math.max(1, Math.min(999, Number(e.currentTarget.value) || r.priority));
                      mut.mutate({ provider: r.provider, enabled: r.enabled, priority: val });
                    }}
                  />
                </label>
              </div>
            </div>
            <p className="mt-1 text-[11px] text-ink-muted">Updated: {r.updated_at}</p>
          </div>
        ))}
      </div>
      {mut.isError ? (
        <p className="text-sm text-red-600">{(mut.error as Error).message}</p>
      ) : null}
      {mut.isPending ? <p className="text-xs text-ink-muted">Menyimpan…</p> : null}
    </div>
  );
}
