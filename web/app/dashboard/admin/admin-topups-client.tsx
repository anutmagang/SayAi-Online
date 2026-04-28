"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { TopupRequestRow } from "@/lib/types";

async function fetchAdminTopups(): Promise<TopupRequestRow[]> {
  const res = await fetch("/api/admin/topups");
  if (res.status === 403) {
    throw new Error("forbidden");
  }
  if (!res.ok) throw new Error("fetch");
  return res.json() as Promise<TopupRequestRow[]>;
}

export function AdminTopupsClient() {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["admin-topups"],
    queryFn: fetchAdminTopups,
    retry: false,
  });

  const mut = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const res = await fetch(`/api/admin/topups/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve, adminNote: note.trim() || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "Gagal");
      }
    },
    onSuccess: () => {
      setNote("");
      setActiveId(null);
      void qc.invalidateQueries({ queryKey: ["admin-topups"] });
      void qc.invalidateQueries({ queryKey: ["topups"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: ["analytics"] });
    },
  });

  if (q.isError && (q.error as Error)?.message === "forbidden") {
    return (
      <p className="text-sm text-red-600">
        Anda tidak memiliki akses admin. Set kolom{" "}
        <code className="rounded bg-subtle px-1">profiles.is_admin = true</code> untuk
        akun Anda di Supabase.
      </p>
    );
  }

  if (q.isPending) {
    return <p className="text-sm text-ink-muted">Memuat…</p>;
  }

  const rows = q.data ?? [];
  const pending = rows.filter((r) => r.status === "pending");

  return (
    <div className="space-y-6">
      <div>
        <LabelBlock />
        <textarea
          className="mt-2 w-full max-w-xl rounded-md border border-edge px-3 py-2 text-sm"
          rows={2}
          placeholder="Catatan untuk user (opsional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <section>
        <h2 className="text-lg font-semibold text-ink">Menunggu verifikasi</h2>
        {!pending.length ? (
          <p className="mt-2 text-sm text-ink-muted">Tidak ada antrian.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {pending.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-edge bg-surface p-4 text-sm shadow-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold tabular-nums">+{r.credits_requested} kredit</span>
                  <code className="text-xs text-ink-muted">{r.user_id}</code>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-ink-muted">{r.payment_note}</p>
                {r.bank_reference ? (
                  <p className="mt-1 text-xs">Ref bank: {r.bank_reference}</p>
                ) : null}
                <time className="mt-2 block text-xs text-ink-muted" dateTime={r.created_at}>
                  {new Date(r.created_at).toLocaleString("id-ID")}
                </time>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={mut.isPending && activeId === r.id}
                    onClick={() => {
                      setActiveId(r.id);
                      mut.mutate({ id: r.id, approve: true });
                    }}
                  >
                    Setujui
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={mut.isPending && activeId === r.id}
                    onClick={() => {
                      setActiveId(r.id);
                      mut.mutate({ id: r.id, approve: false });
                    }}
                  >
                    Tolak
                  </Button>
                </div>
                {mut.isError && activeId === r.id ? (
                  <p className="mt-2 text-xs text-red-600">
                    {(mut.error as Error).message}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-ink">Terbaru (100)</h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-edge">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-subtle text-ink-muted">
              <tr>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Kredit</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Dibuat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-edge">
                  <td className="px-3 py-2 capitalize">{r.status}</td>
                  <td className="px-3 py-2 tabular-nums">{r.credits_requested}</td>
                  <td className="px-3 py-2 font-mono text-[10px]">{r.user_id.slice(0, 8)}…</td>
                  <td className="px-3 py-2">{new Date(r.created_at).toLocaleDateString("id-ID")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function LabelBlock() {
  return (
    <p className="text-sm text-ink-muted">
      Tinjau bukti transfer di catatan user, lalu setujui atau tolak. Kredit ditambahkan otomatis
      saat disetujui.
    </p>
  );
}
