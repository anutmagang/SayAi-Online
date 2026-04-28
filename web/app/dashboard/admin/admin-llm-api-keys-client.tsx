"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

type TierScope = "free" | "starter" | "creator" | "pro";

type PoolRow = {
  id: string;
  provider: "groq" | "gemini" | "openai" | "openrouter" | "anthropic";
  label: string;
  key_hint: string;
  sort_order: number;
  enabled: boolean;
  applies_to_tier: TierScope | null;
  created_at: string;
  health_status?: string | null;
  cooldown_until?: string | null;
  next_probe_at?: string | null;
  last_error?: string | null;
  probe_fail_streak?: number | null;
  last_success_at?: string | null;
};

type TierTab = "all" | TierScope;

async function fetchKeys(): Promise<PoolRow[]> {
  const res = await fetch("/api/admin/llm-api-keys");
  if (res.status === 403) throw new Error("forbidden");
  if (!res.ok) throw new Error("fetch");
  return res.json() as Promise<PoolRow[]>;
}

const PROVIDERS: { id: PoolRow["provider"]; label: string }[] = [
  { id: "groq", label: "Groq" },
  { id: "gemini", label: "Gemini" },
  { id: "openai", label: "OpenAI (resmi)" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "anthropic", label: "Anthropic" },
];

const TIER_TABS: { id: TierTab; label: string }[] = [
  { id: "all", label: "Semua" },
  { id: "free", label: "Free" },
  { id: "starter", label: "Starter" },
  { id: "creator", label: "Creator" },
  { id: "pro", label: "Pro" },
];

function rowMatchesTierTab(row: PoolRow, tab: TierTab): boolean {
  if (tab === "all") return true;
  return row.applies_to_tier == null || row.applies_to_tier === tab;
}

function tierScopeLabel(t: TierScope | null): string {
  if (t == null) return "Semua tier";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function AdminLlmApiKeysClient() {
  const qc = useQueryClient();
  const [provider, setProvider] = useState<PoolRow["provider"]>("groq");
  const [label, setLabel] = useState("");
  const [plaintext, setPlaintext] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [appliesToTier, setAppliesToTier] = useState<TierScope | "">("");
  const [tierTab, setTierTab] = useState<TierTab>("all");
  const [formErr, setFormErr] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["admin-llm-api-keys"],
    queryFn: fetchKeys,
    retry: false,
    refetchInterval: 12_000,
  });

  const addMut = useMutation({
    mutationFn: async () => {
      setFormErr(null);
      const res = await fetch("/api/admin/llm-api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          label: label.trim(),
          plaintextKey: plaintext,
          sortOrder,
          appliesToTier: appliesToTier === "" ? null : appliesToTier,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Gagal menambah key");
      return body;
    },
    onSuccess: () => {
      setPlaintext("");
      setLabel("");
      setSortOrder(0);
      setAppliesToTier("");
      void qc.invalidateQueries({ queryKey: ["admin-llm-api-keys"] });
    },
    onError: (e: unknown) => {
      setFormErr(e instanceof Error ? e.message : "Error");
    },
  });

  const patchMut = useMutation({
    mutationFn: async (payload: { id: string; body: Record<string, unknown> }) => {
      const res = await fetch(`/api/admin/llm-api-keys/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload.body),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Gagal memperbarui");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-llm-api-keys"] }),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/llm-api-keys/${id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Gagal menghapus");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-llm-api-keys"] }),
  });

  const rows = q.data ?? [];
  const visibleRows = useMemo(
    () => rows.filter((r) => rowMatchesTierTab(r, tierTab)),
    [rows, tierTab],
  );

  if (q.isError && (q.error as Error)?.message === "forbidden") {
    return (
      <p className="text-sm text-red-600">
        Anda tidak memiliki akses admin untuk mengelola stok key.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">
        Simpan beberapa key per penyedia (terenkripsi di database). Urutan{" "}
        <span className="font-mono text-xs">sort_order</span> menentukan prioritas; worker
        merotasi per <span className="font-mono text-xs">CLIPPER_JOB_ID</span> dan menandai cooldown
        per key saat 429; cron{" "}
        <span className="font-mono text-xs">/api/cron/llm-key-health</span> mem-probe setelah
        jeda.{" "}
        <strong>Berlaku untuk tier</strong> membatasi key ke job tertentu (mis. key gratis hanya
        Free); pilih <em>Semua tier</em> agar key dipakai semua job yang cocok penyedia. Key di
        env (mis. <span className="font-mono text-xs">GROQ_API_KEY</span>,{" "}
        <span className="font-mono text-xs">OPENAI_API_KEY</span>,{" "}
        <span className="font-mono text-xs">OPENROUTER_API_KEY</span>) dipakai setelah stok pool.
        Set{" "}
        <span className="font-mono text-xs">API_KEY_POOL_MASTER_SECRET</span> (≥12 karakter) yang
        sama di <span className="font-mono text-xs">web/.env.local</span> dan root{" "}
        <span className="font-mono text-xs">.env</span> agar worker bisa mendekripsi.
      </p>

      <div className="flex flex-wrap gap-2 border-b border-edge pb-2">
        {TIER_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTierTab(t.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              tierTab === t.id
                ? "bg-ink text-white"
                : "bg-subtle text-ink-muted hover:bg-edge/60"
            }`}
          >
            {t.label}
            {t.id !== "all" ? (
              <span className="ml-1 opacity-70">
                ({rows.filter((r) => rowMatchesTierTab(r, t.id)).length})
              </span>
            ) : (
              <span className="ml-1 opacity-70">({rows.length})</span>
            )}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-edge bg-surface p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-ink">Tambah key ke stok</h3>
        <div className="mt-3 grid max-w-xl gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-ink-muted">Penyedia</span>
            <select
              className="rounded-md border border-edge px-3 py-2"
              value={provider}
              onChange={(e) => setProvider(e.target.value as PoolRow["provider"])}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ink-muted">Berlaku untuk tier job</span>
            <select
              className="rounded-md border border-edge px-3 py-2"
              value={appliesToTier}
              onChange={(e) => setAppliesToTier(e.target.value as TierScope | "")}
            >
              <option value="">Semua tier (null)</option>
              <option value="free">Free saja</option>
              <option value="starter">Starter saja</option>
              <option value="creator">Creator saja</option>
              <option value="pro">Pro saja</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ink-muted">Label (opsional)</span>
            <input
              className="rounded-md border border-edge px-3 py-2"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="mis. akun cadangan A"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ink-muted">API key (plaintext, tidak disimpan mentah)</span>
            <input
              className="rounded-md border border-edge px-3 py-2 font-mono text-xs"
              type="password"
              autoComplete="off"
              value={plaintext}
              onChange={(e) => setPlaintext(e.target.value)}
              placeholder="Tempel key sekali — tidak bisa dilihat lagi setelah simpan"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ink-muted">Urutan (0 = pertama)</span>
            <input
              type="number"
              min={0}
              max={9999}
              className="rounded-md border border-edge px-3 py-2"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
            />
          </label>
          {formErr ? <p className="text-sm text-red-600">{formErr}</p> : null}
          <Button
            type="button"
            variant="primary"
            disabled={addMut.isPending || plaintext.trim().length < 8}
            onClick={() => addMut.mutate()}
          >
            {addMut.isPending ? "Menyimpan…" : "Simpan ke stok"}
          </Button>
        </div>
      </div>

      {q.isPending ? (
        <p className="text-sm text-ink-muted">Memuat stok…</p>
      ) : visibleRows.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {rows.length === 0
            ? "Belum ada key di pool."
            : "Tidak ada key untuk tab tier ini (coba Semua atau tier lain)."}
        </p>
      ) : (
        <ul className="space-y-3">
          {visibleRows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge bg-subtle/80 px-4 py-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <span className="font-semibold uppercase text-xs text-ink-muted">
                  {r.provider}
                </span>
                {r.label ? <span className="ml-2 text-ink">{r.label}</span> : null}
                <span className="ml-2 font-mono text-xs text-ink-muted">{r.key_hint}</span>
                <span className="ml-2 text-xs text-ink-muted">order {r.sort_order}</span>
                <span className="ml-2 rounded bg-sky-100 px-2 py-0.5 text-[11px] text-sky-900">
                  {tierScopeLabel(r.applies_to_tier)}
                </span>
                {!r.enabled ? (
                  <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                    nonaktif
                  </span>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-ink-muted">Ubah tier:</span>
                  <select
                    className="rounded border border-edge bg-surface px-2 py-1 text-xs"
                    value={r.applies_to_tier ?? ""}
                    disabled={patchMut.isPending}
                    onChange={(e) => {
                      const v = e.target.value;
                      patchMut.mutate({
                        id: r.id,
                        body: { appliesToTier: v === "" ? null : v },
                      });
                    }}
                  >
                    <option value="">Semua tier</option>
                    <option value="free">Free</option>
                    <option value="starter">Starter</option>
                    <option value="creator">Creator</option>
                    <option value="pro">Pro</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="text-xs"
                  disabled={patchMut.isPending}
                  onClick={() =>
                    patchMut.mutate({ id: r.id, body: { clearRuntimeCooldown: true } })
                  }
                >
                  Reset cooldown
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="text-xs"
                  disabled={patchMut.isPending}
                  onClick={() =>
                    patchMut.mutate({ id: r.id, body: { enabled: !r.enabled } })
                  }
                >
                  {r.enabled ? "Nonaktifkan" : "Aktifkan"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-xs text-red-700"
                  disabled={delMut.isPending}
                  onClick={() => {
                    if (confirm("Hapus key ini dari pool?")) delMut.mutate(r.id);
                  }}
                >
                  Hapus
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
