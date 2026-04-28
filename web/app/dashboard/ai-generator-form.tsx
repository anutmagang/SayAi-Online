"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Kind = "image_gen" | "video_gen";
type Aspect = "1:1" | "9:16" | "16:9" | "4:3" | "3:4";

export function AIGeneratorForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<Kind>("image_gen");
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<Aspect>("1:1");
  const [durationSec, setDurationSec] = useState(4);
  const [model, setModel] = useState("fast");
  const [quote, setQuote] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const quotePayload = useMemo(
    () => ({ kind, aspectRatio, durationSec: kind === "video_gen" ? durationSec : undefined, model }),
    [kind, aspectRatio, durationSec, model],
  );

  useEffect(() => {
    let cancelled = false;
    async function fetchQuote() {
      const res = await fetch("/api/ai/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quotePayload),
      });
      const json = (await res.json().catch(() => ({}))) as { credits?: number };
      if (!cancelled) setQuote(typeof json.credits === "number" ? json.credits : null);
    }
    void fetchQuote();
    return () => {
      cancelled = true;
    };
  }, [quotePayload]);

  const mutation = useMutation({
    mutationFn: async () => {
      setError(null);
      const body: Record<string, unknown> = {
        kind,
        prompt: prompt.trim(),
        aspectRatio,
        model,
        idempotencyKey: crypto.randomUUID(),
      };
      if (kind === "video_gen") body.durationSec = durationSec;
      const res = await fetch("/api/ai/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        jobId?: string;
        error?: string;
      };
      if (!res.ok || !json.jobId) {
        throw new Error(json.error ?? "Gagal membuat AI generator job");
      }
      return json.jobId;
    },
    onSuccess: (jobId) => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      router.push(`/dashboard/jobs/${jobId}`);
      router.refresh();
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan");
    },
  });

  return (
    <Card className="p-4">
      <h3 className="text-base font-semibold text-ink">AI Generator (Phase 3)</h3>
      <p className="mt-1 text-xs text-ink-muted">
        Estimasi biaya dinamis: <strong>{quote ?? "..."} kredit</strong> (sebelum submit).
      </p>
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded border border-edge px-3 py-2 text-sm">
            <input type="radio" name="ai-kind" checked={kind === "image_gen"} onChange={() => setKind("image_gen")} />
            Image generator
          </label>
          <label className="flex items-center gap-2 rounded border border-edge px-3 py-2 text-sm">
            <input type="radio" name="ai-kind" checked={kind === "video_gen"} onChange={() => setKind("video_gen")} />
            Video generator
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="ai-model">Mode model</Label>
            <select
              id="ai-model"
              className="h-10 rounded-md border border-edge bg-surface px-3 text-sm"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              <option value="fast">Fast</option>
              <option value="quality">Quality</option>
              <option value="cinematic">Cinematic</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ai-aspect">Aspect ratio</Label>
            <select
              id="ai-aspect"
              className="h-10 rounded-md border border-edge bg-surface px-3 text-sm"
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as Aspect)}
            >
              <option value="1:1">1:1</option>
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="ai-prompt">Prompt</Label>
          <Input
            id="ai-prompt"
            required
            minLength={3}
            maxLength={2000}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Contoh: neon cyberpunk city at night, cinematic lighting"
          />
        </div>

        {kind === "video_gen" ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="ai-duration">Durasi video (detik)</Label>
            <Input
              id="ai-duration"
              type="number"
              min={2}
              max={12}
              value={durationSec}
              onChange={(e) =>
                setDurationSec(Math.max(2, Math.min(12, Math.round(Number(e.target.value) || 4))))
              }
            />
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button type="submit" disabled={mutation.isPending || !prompt.trim()}>
          {mutation.isPending ? "Membuat AI job..." : `Generate (${quote ?? "..."} kredit)`}
        </Button>
      </form>
    </Card>
  );
}
