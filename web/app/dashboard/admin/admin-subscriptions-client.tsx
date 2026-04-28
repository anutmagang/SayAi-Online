"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { subscriptionApprovalBonusCredits } from "@/lib/credits-pricing";
import { TIER_DETAILS, type Tier } from "@/lib/tiers";

type SubReq = {
  id: string;
  user_id: string;
  requested_tier: Tier;
  months: number;
  status: "pending" | "approved" | "rejected";
  payment_note: string | null;
  bank_reference: string | null;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
};

async function fetchAdminSubs(): Promise<SubReq[]> {
  const res = await fetch("/api/admin/subscriptions");
  if (res.status === 403) throw new Error("forbidden");
  if (!res.ok) throw new Error("fetch");
  return res.json() as Promise<SubReq[]>;
}

export function AdminSubscriptionsClient() {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["admin-subs"],
    queryFn: fetchAdminSubs,
    retry: false,
  });

  const mut = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const res = await fetch(`/api/admin/subscriptions/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve, adminNote: note.trim() || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Gagal");
    },
    onSuccess: () => {
      setNote("");
      setActiveId(null);
      void qc.invalidateQueries({ queryKey: ["admin-subs"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  if (q.isError && (q.error as Error)?.message === "forbidden") {
    return (
      <p className="mt-2 text-sm text-red-600">
        Anda bukan admin. Set{" "}
        <code className="rounded bg-subtle px-1">profiles.is_admin = true</code>.
      </p>
    );
  }
  if (q.isPending) return <p className="mt-2 text-sm text-ink-muted">Memuat…</p>;

  const rows = q.data ?? [];
  const pending = rows.filter((r) => r.status === "pending");

  return (
    <div className="mt-4 space-y-4">
      <textarea
        className="w-full max-w-xl rounded-md border border-edge px-3 py-2 text-sm"
        rows={2}
        placeholder="Catatan untuk user (opsional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      {!pending.length ? (
        <p className="text-sm text-ink-muted">Tidak ada antrian upgrade.</p>
      ) : (
        <ul className="space-y-3">
          {pending.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-edge bg-surface p-4 text-sm shadow-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">
                  Upgrade →{" "}
                  {TIER_DETAILS[r.requested_tier]?.label ?? r.requested_tier}
                  <span className="ml-2 text-xs text-ink-muted">
                    {r.months} bln
                  </span>
                </span>
                <code className="text-xs text-ink-muted">{r.user_id}</code>
              </div>
              {r.payment_note ? (
                <p className="mt-2 whitespace-pre-wrap text-ink-muted">
                  {r.payment_note}
                </p>
              ) : null}
              {r.bank_reference ? (
                <p className="mt-1 text-xs">Ref: {r.bank_reference}</p>
              ) : null}
              <time className="mt-2 block text-xs text-ink-muted">
                {new Date(r.created_at).toLocaleString("id-ID")}
              </time>
              {r.requested_tier !== "free" ? (
                <p className="mt-2 text-xs text-emerald-800">
                  Setujui → saldo user +{subscriptionApprovalBonusCredits(r.requested_tier)} kredit
                  bonus sekali (sesuai paket {TIER_DETAILS[r.requested_tier].label}).
                </p>
              ) : null}
              <div className="mt-3 flex gap-2">
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
    </div>
  );
}
