"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TopupRequestRow } from "@/lib/types";
import { estimatedTopupPaymentIdr, formatCreditTopupUnitPrice } from "@/lib/credits-pricing";

async function fetchTopups(): Promise<TopupRequestRow[]> {
  const res = await fetch("/api/topups");
  if (!res.ok) throw new Error("Gagal memuat riwayat");
  return res.json() as Promise<TopupRequestRow[]>;
}

export function TopupForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const [credits, setCredits] = useState("10");
  const [note, setNote] = useState("");
  const [ref, setRef] = useState("");
  const [error, setError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["topups"],
    queryFn: fetchTopups,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      setError(null);
      const n = Number(credits);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error("Jumlah kredit tidak valid");
      }
      const res = await fetch("/api/topups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creditsRequested: Math.floor(n),
          paymentNote: note.trim(),
          bankReference: ref.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "Gagal mengirim");
      }
      return body.id;
    },
    onSuccess: () => {
      setNote("");
      setRef("");
      void qc.invalidateQueries({ queryKey: ["topups"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: ["analytics"] });
      router.refresh();
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan");
    },
  });

  return (
    <div className="space-y-8">
      <Card>
        <h2 className="text-lg font-semibold text-ink">Ajukan top-up manual</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Harga referensi: <strong>{formatCreditTopupUnitPrice()}</strong> (semua tier,
          termasuk Free, boleh mengajukan top-up). Isi jumlah kredit dan bukti transfer;
          admin memverifikasi lalu menambah saldo. Estimasi nominal setoran:{" "}
          <strong>
            Rp {estimatedTopupPaymentIdr(Number(credits) || 0).toLocaleString("id-ID")}
          </strong>{" "}
          untuk {Math.max(0, Math.floor(Number(credits) || 0))} kredit (belum termasuk fee
          bank; sesuaikan dengan instruksi admin).
        </p>
        <form
          className="mt-6 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="credits">Kredit diminta</Label>
            <Input
              id="credits"
              inputMode="numeric"
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="note">Keterangan pembayaran</Label>
            <textarea
              id="note"
              required
              minLength={8}
              rows={4}
              className="rounded-md border border-edge px-3 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="Contoh: Transfer BCA 50.000 ke … tanggal … atas nama …"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ref">Referensi bank (opsional)</Label>
            <Input
              id="ref"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="No. referensi / berita transfer"
            />
          </div>
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" disabled={mutation.isPending}>
            {mutation.isPending ? "Mengirim…" : "Kirim permintaan"}
          </Button>
        </form>
      </Card>

      <section>
        <h2 className="text-lg font-semibold text-ink">Riwayat permintaan</h2>
        {listQ.isError ? (
          <p className="mt-2 text-sm text-red-600">Tidak dapat memuat data.</p>
        ) : !listQ.data?.length ? (
          <p className="mt-2 text-sm text-ink-muted">Belum ada permintaan.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {listQ.data.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-edge bg-surface p-4 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium tabular-nums">
                    +{r.credits_requested} kredit
                  </span>
                  <StatusPill status={r.status} />
                </div>
                <p className="mt-2 whitespace-pre-wrap text-ink-muted">{r.payment_note}</p>
                {r.bank_reference ? (
                  <p className="mt-1 text-xs text-ink-muted">Ref: {r.bank_reference}</p>
                ) : null}
                {r.admin_note ? (
                  <p className="mt-2 text-xs text-ink">Catatan admin: {r.admin_note}</p>
                ) : null}
                <time className="mt-2 block text-xs text-ink-muted" dateTime={r.created_at}>
                  {new Date(r.created_at).toLocaleString("id-ID")}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-900",
    approved: "bg-emerald-100 text-emerald-900",
    rejected: "bg-red-100 text-red-900",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? "bg-subtle"}`}
    >
      {status}
    </span>
  );
}
