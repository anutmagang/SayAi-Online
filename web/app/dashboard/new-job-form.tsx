"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs } from "@/components/ui/tabs";
import { isYoutubeUrl } from "@/lib/url-validator";
import {
  MAX_CLIPS_PER_JOB,
  MIN_CLIPS_PER_JOB,
  maxClipsAllowedForTier,
  type Tier,
} from "@/lib/tiers";

export type WatermarkJobDefaults = {
  paidEnabled: boolean;
  customText: string | null;
  position: string;
};

const WM_POSITIONS = [
  { value: "top_left", label: "Atas kiri" },
  { value: "top_right", label: "Atas kanan" },
  { value: "bottom_left", label: "Bawah kiri" },
  { value: "bottom_right", label: "Bawah kanan" },
  { value: "center", label: "Tengah" },
] as const;

async function uploadToStorage(
  file: File,
  onProgress: (pct: number) => void,
): Promise<string> {
  const initRes = await fetch("/api/uploads/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
    }),
  });
  const initBody = (await initRes.json().catch(() => ({}))) as {
    path?: string;
    signedUrl?: string;
    error?: string;
  };
  if (!initRes.ok || !initBody.signedUrl || !initBody.path) {
    throw new Error(initBody.error ?? "Gagal menyiapkan upload URL");
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", initBody.signedUrl!);
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload gagal (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload gagal (network error)"));
    xhr.send(file);
  });

  return initBody.path;
}

export function NewJobForm({
  durationHint,
  userTier,
  isAdmin = false,
  monthlyQuota,
  monthlyUsed,
  creditsBalance,
  watermarkDefaults = null,
}: {
  durationHint: string;
  userTier: Tier;
  isAdmin?: boolean;
  monthlyQuota: number;
  monthlyUsed: number;
  creditsBalance: number;
  /** Hanya tier berbayar — untuk pratinjau teks/posisi default dari Pengaturan akun. */
  watermarkDefaults?: WatermarkJobDefaults | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const tierMax = maxClipsAllowedForTier(userTier);
  const [mode, setMode] = useState<"url" | "upload">("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Default di bawah plafon tier (maks 8). */
  const [maxClips, setMaxClips] = useState(() => Math.min(8, tierMax));
  useEffect(() => {
    setMaxClips((c) => Math.min(Math.max(MIN_CLIPS_PER_JOB, c), tierMax));
  }, [tierMax]);
  /** Rentang durasi tiap klip (detik) — diteruskan ke CLIP_MIN_DURATION / CLIP_MAX_DURATION. */
  const [clipMinSec, setClipMinSec] = useState(20);
  const [clipMaxSec, setClipMaxSec] = useState(90);
  const [outputLayout, setOutputLayout] = useState<"short_vertical" | "long_horizontal">(
    "short_vertical",
  );
  const [wmJobMode, setWmJobMode] = useState<"profile" | "off" | "custom">("profile");
  const [wmJobText, setWmJobText] = useState(() => watermarkDefaults?.customText ?? "");
  const [wmJobPos, setWmJobPos] = useState(
    () => watermarkDefaults?.position ?? "bottom_right",
  );

  const quotaFullUsesCredits =
    !isAdmin &&
    userTier !== "free" &&
    monthlyQuota > 0 &&
    monthlyUsed >= monthlyQuota &&
    creditsBalance >= 1;

  const mutation = useMutation({
    mutationFn: async () => {
      setError(null);
      setUploadPct(0);

      if (clipMaxSec < clipMinSec + 5) {
        throw new Error(
          "Durasi maksimal harus minimal (minimal + 5) detik — naikkan maks atau turunkan minimal.",
        );
      }
      if (userTier !== "free" && wmJobMode === "custom" && !wmJobText.trim()) {
        throw new Error("Isi teks watermark untuk mode kustom, atau pilih pengaturan akun / tanpa watermark.");
      }

      let payload: Record<string, unknown>;
      if (mode === "url") {
        const trimmed = url.trim();
        if (!trimmed) throw new Error("Masukkan URL video");
        if (!isYoutubeUrl(trimmed)) {
          throw new Error(
            "Saat ini hanya URL YouTube yang didukung (youtube.com / youtu.be). Untuk platform lain, unduh filenya dulu lalu upload.",
          );
        }
        payload = {
          kind: "url",
          url: trimmed,
          maxClips,
          clipMinDurationSec: clipMinSec,
          clipMaxDurationSec: clipMaxSec,
          outputLayout,
        };
      } else {
        if (!file) throw new Error("Pilih file video");
        const storagePath = await uploadToStorage(file, setUploadPct);
        payload = {
          kind: "upload",
          storagePath,
          originalName: file.name,
          maxClips,
          clipMinDurationSec: clipMinSec,
          clipMaxDurationSec: clipMaxSec,
          outputLayout,
        };
      }

      if (userTier !== "free") {
        if (wmJobMode === "off") {
          payload.watermarkJobMode = "off";
        } else if (wmJobMode === "custom") {
          payload.watermarkJobMode = "custom";
          payload.watermarkJobText = wmJobText.trim();
          payload.watermarkJobPosition = wmJobPos;
        }
        /* mode "profile": jangan kirim field — API pakai preferensi akun. */
      }

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        jobId?: string;
        error?: string;
        usedCreditFallback?: boolean;
      };
      if (!res.ok) {
        throw new Error(body.error ?? "Gagal membuat job");
      }
      return body as { jobId: string; usedCreditFallback?: boolean };
    },
    onSuccess: (body) => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      const q = body.usedCreditFallback ? "?billed=credit" : "";
      router.push(`/dashboard/jobs/${body.jobId}${q}`);
      router.refresh();
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan");
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  const uploading = mutation.isPending && mode === "upload" && uploadPct > 0 && uploadPct < 100;

  return (
    <Card>
      <Tabs
        value={mode}
        onValueChange={(v) => setMode(v as "url" | "upload")}
        tabs={[
          { id: "url", label: "URL YouTube" },
          { id: "upload", label: "Upload file" },
        ]}
      />
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        {quotaFullUsesCredits ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Kuota bulanan paket Anda sudah mencapai batas. Job berikutnya akan
            memotong <strong>1 kredit</strong> per job (sama seperti paket Free) selama
            masih ada saldo kredit.
          </p>
        ) : null}
        {mode === "url" ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="video-url">URL YouTube</Label>
            <Input
              id="video-url"
              type="url"
              required
              placeholder="https://www.youtube.com/watch?v=…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <p className="text-xs text-ink-muted">
              {durationHint} Hanya YouTube untuk saat ini — platform lain silakan
              unduh dulu, lalu unggah via tab “Upload file”.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Label htmlFor="video-file">File video / audio</Label>
            <Input
              id="video-file"
              type="file"
              accept="video/*,audio/*,.mp4,.webm,.mov,.mkv,.m4a,.mp3,.wav"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-ink-muted">
              {durationHint} File diunggah langsung ke Supabase Storage (tidak
              melewati RAM aplikasi). Batas ukuran 2 GB.
            </p>
            {uploading ? (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-subtle">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
            ) : null}
            {uploading ? (
              <p className="text-xs text-ink-muted">
                Upload {uploadPct}%…
              </p>
            ) : null}
          </div>
        )}
        <fieldset className="flex flex-col gap-2 rounded-lg border border-edge bg-subtle/30 p-4">
          <legend className="px-1 text-sm font-semibold text-ink">
            Jenis output job (semua paket)
          </legend>
          <p className="text-xs text-ink-muted">
            Pilih format file MP4 akhir. Caption &amp; hashtag untuk posting dibuat AI dan
            tampil di halaman hasil job — tidak ditulis sebagai subtitle di dalam video.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
            <label className="flex flex-1 cursor-pointer gap-3 rounded-lg border border-edge bg-surface p-3 has-[:checked]:border-accent has-[:checked]:ring-1 has-[:checked]:ring-accent">
              <input
                type="radio"
                name="output-layout"
                className="mt-1"
                checked={outputLayout === "short_vertical"}
                onChange={() => setOutputLayout("short_vertical")}
              />
              <span className="min-w-0">
                <span className="font-medium text-ink">Shorts / Reels / TikTok</span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  <strong className="text-ink">9:16</strong> vertikal (1080×1920), standar
                  short-form. Paket Free: watermark &quot;Fai-Clipper&quot; di video.
                </span>
              </span>
            </label>
            <label className="flex flex-1 cursor-pointer gap-3 rounded-lg border border-edge bg-surface p-3 has-[:checked]:border-accent has-[:checked]:ring-1 has-[:checked]:ring-accent">
              <input
                type="radio"
                name="output-layout"
                className="mt-1"
                checked={outputLayout === "long_horizontal"}
                onChange={() => setOutputLayout("long_horizontal")}
              />
              <span className="min-w-0">
                <span className="font-medium text-ink">Konten video / horizontal</span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  <strong className="text-ink">16:9</strong> Full HD (1920×1080), standar
                  YouTube dan video umum. Paket Free: watermark &quot;Fai-Clipper&quot; di
                  video. Berbayar: video bersih kecuali watermark diaktifkan di Pengaturan.
                </span>
              </span>
            </label>
          </div>
        </fieldset>
        <div className="flex flex-col gap-1">
          <Label htmlFor="max-clips">
            Maks. jumlah klip ({MIN_CLIPS_PER_JOB}–{tierMax} untuk paket {userTier})
          </Label>
          <Input
            id="max-clips"
            type="number"
            min={MIN_CLIPS_PER_JOB}
            max={tierMax}
            value={maxClips}
            onChange={(e) =>
              setMaxClips(
                Math.max(
                  MIN_CLIPS_PER_JOB,
                  Math.min(tierMax, Number(e.target.value) || Math.min(8, tierMax)),
                ),
              )
            }
          />
          <p className="text-xs text-ink-muted">
            Paket <strong>{userTier}</strong>: paling banyak <strong>{tierMax}</strong>{" "}
            klip per job (plafon global API {MAX_CLIPS_PER_JOB}). Lebih banyak klip =
            token LLM &amp; waktu render naik.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="clip-min-sec">Durasi klip — minimal (detik)</Label>
            <Input
              id="clip-min-sec"
              type="number"
              min={10}
              max={120}
              value={clipMinSec}
              onChange={(e) =>
                setClipMinSec(
                  Math.max(10, Math.min(120, Math.round(Number(e.target.value) || 20))),
                )
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="clip-max-sec">Durasi klip — maksimal (detik)</Label>
            <Input
              id="clip-max-sec"
              type="number"
              min={15}
              max={180}
              value={clipMaxSec}
              onChange={(e) =>
                setClipMaxSec(
                  Math.max(15, Math.min(180, Math.round(Number(e.target.value) || 90))),
                )
              }
            />
          </div>
        </div>
        {userTier === "free" ? (
          <div className="rounded-lg border border-edge/80 bg-canvas/40 px-3 py-2.5">
            <p className="text-xs font-medium text-ink">Watermark video (Free)</p>
            <p className="mt-1 text-xs text-ink-muted leading-relaxed">
              Setiap file MP4 keluaran memuat watermark bawaan{" "}
              <strong className="text-ink">Fai-Clipper</strong> (bukan subtitle posting).
              Posisi default kanan bawah — ini kebijakan paket Free, bukan pengaturan opsional.
            </p>
          </div>
        ) : (
          <fieldset className="rounded-lg border border-edge/80 bg-canvas/40 px-3 py-3 space-y-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Watermark di video (opsional)
            </legend>
            <p className="text-xs text-ink-muted leading-relaxed">
              Bukan subtitle: teks semi-transparan di atas piksel video. Default mengikuti{" "}
              <strong className="text-ink">Pengaturan akun</strong> (watermark berbayar).
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wm-job-mode">Mode untuk job ini</Label>
              <select
                id="wm-job-mode"
                className="rounded-md border border-edge bg-surface px-3 py-2 text-sm text-ink"
                value={wmJobMode}
                onChange={(e) => setWmJobMode(e.target.value as "profile" | "off" | "custom")}
              >
                <option value="profile">Ikuti pengaturan akun</option>
                <option value="off">Tanpa watermark</option>
                <option value="custom">Watermark kustom (job ini saja)</option>
              </select>
            </div>
            {wmJobMode === "custom" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <Label htmlFor="wm-job-text">Teks watermark</Label>
                  <Input
                    id="wm-job-text"
                    value={wmJobText}
                    onChange={(e) => setWmJobText(e.target.value)}
                    maxLength={120}
                    placeholder={watermarkDefaults?.customText || "Merek / CTA singkat"}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="wm-job-pos">Posisi</Label>
                  <select
                    id="wm-job-pos"
                    className="rounded-md border border-edge bg-surface px-3 py-2 text-sm text-ink"
                    value={wmJobPos}
                    onChange={(e) => setWmJobPos(e.target.value)}
                  >
                    {WM_POSITIONS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}
            {watermarkDefaults && !watermarkDefaults.paidEnabled && wmJobMode === "profile" ? (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                Di profil Anda watermark berbayar masih mati — hasil akan tanpa watermark kecuali
                Anda pilih mode kustom di atas atau mengaktifkan watermark di Pengaturan akun.
              </p>
            ) : null}
          </fieldset>
        )}
        <p className="text-xs text-ink-muted -mt-2">
          Maksimal harus ≥ minimal + 5 detik. Untuk skor viral di dashboard, rentang
          sekitar <strong>20–55 detik</strong> per klip paling menguntungkan. Teks untuk
          posting (caption &amp; hashtag) dibuat AI per klip dan hanya di halaman ini,
          bukan subtitle di dalam file video.
        </p>
        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          disabled={mutation.isPending}
          className="py-2.5"
        >
          {mutation.isPending
            ? uploading
              ? `Mengunggah ${uploadPct}%…`
              : "Membuat job…"
            : "Buat klip"}
        </Button>
        <p className="text-xs text-ink-muted">
          Job akan berjalan di background. Anda bisa close tab — progress tetap
          tersimpan.
        </p>
      </form>
    </Card>
  );
}
