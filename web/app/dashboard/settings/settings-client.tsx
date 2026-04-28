"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  allowedLlmPreferencesForTier,
  isLlmPreferenceAllowedForTier,
  providerMinimumTierLabel,
} from "@/lib/llm-access";
import type { CatalogProviderKey, LlmCatalogApiResponse } from "@/lib/llm-catalog-types";
import {
  LLM_MODELS_BY_PROVIDER,
  type LlmProviderId,
} from "@/lib/llm-models";
import { TIER_DETAILS } from "@/lib/tiers";

function openAiMergedCatalogRow(catalog: LlmCatalogApiResponse) {
  const o = catalog.providers.openai;
  const r = catalog.providers.openrouter;
  const liveIds = Array.from(
    new Set([...(r?.liveIds ?? []), ...(o?.liveIds ?? [])]),
  );
  const times = [o?.lastSuccessAt, r?.lastSuccessAt].filter(Boolean) as string[];
  const lastSuccessAt = times.length ? times.sort().reverse()[0]! : null;
  const fetchError = r?.fetchError || o?.fetchError || null;
  return { liveIds, lastSuccessAt, fetchError };
}

function catalogModelSuffix(
  pref: LlmProviderId,
  modelId: string,
  catalog: LlmCatalogApiResponse | undefined,
): string {
  if (pref === "auto" || pref === "anthropic" || !catalog) return "";
  if (pref === "openai") {
    const row = openAiMergedCatalogRow(catalog);
    if (!row.lastSuccessAt || row.liveIds.length === 0) return "";
    return row.liveIds.includes(modelId)
      ? " · tersedia (sinkron API)"
      : " · tidak muncul di sinkron terakhir";
  }
  const pRow = catalog.providers[pref as CatalogProviderKey];
  if (!pRow?.lastSuccessAt || pRow.liveIds.length === 0) return "";
  return pRow.liveIds.includes(modelId)
    ? " · tersedia (sinkron API)"
    : " · tidak muncul di sinkron terakhir";
}

const PROVIDER_OPTIONS: {
  id: LlmProviderId;
  label: string;
  description: string;
}[] = [
  {
    id: "auto",
    label: "Auto (rekomendasi)",
    description: "Sistem memilih rantai model terbaik untuk tier Anda.",
  },
  {
    id: "groq",
    label: "Groq",
    description: "Llama / Mixtral — sangat cepat.",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    description: "Konteks panjang, analisa naratif.",
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "GPT-4o family.",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude 3.x / 3.5.",
  },
];

function tierLlmHelpText(tier: "free" | "starter" | "creator" | "pro"): string {
  switch (tier) {
    case "free":
      return "Paket Free: hanya mode Auto.";
    case "starter":
      return "Paket Starter: Auto, Groq, atau Gemini — sesuai deskripsi langganan Anda.";
    case "creator":
      return "Paket Creator: Auto, Groq, Gemini, atau OpenAI.";
    case "pro":
      return "Paket Pro: semua penyedia termasuk Anthropic.";
    default:
      return "";
  }
}

const WM_POSITIONS: {
  id: "top_left" | "top_right" | "bottom_left" | "bottom_right" | "center";
  label: string;
}[] = [
  { id: "top_left", label: "Kiri atas" },
  { id: "top_right", label: "Kanan atas" },
  { id: "bottom_left", label: "Kiri bawah" },
  { id: "bottom_right", label: "Kanan bawah" },
  { id: "center", label: "Tengah" },
];

export function SettingsClient({
  email,
  tier,
  isAdmin,
  llmPreference,
  llmModelId,
  watermarkPaidEnabled,
  watermarkCustomText,
  watermarkPosition,
}: {
  email: string;
  tier: "free" | "starter" | "creator" | "pro";
  isAdmin: boolean;
  llmPreference: LlmProviderId;
  llmModelId: string | null;
  watermarkPaidEnabled: boolean;
  watermarkCustomText: string;
  watermarkPosition: (typeof WM_POSITIONS)[number]["id"];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: catalog } = useQuery({
    queryKey: ["llm-models-catalog"],
    queryFn: async (): Promise<LlmCatalogApiResponse | undefined> => {
      const res = await fetch("/api/models/catalog");
      if (!res.ok) return undefined;
      return (await res.json()) as LlmCatalogApiResponse;
    },
    staleTime: 60_000,
  });
  const [pref, setPref] = useState<LlmProviderId>(llmPreference);
  const [modelId, setModelId] = useState<string>(() => {
    if (llmPreference === "auto") return "";
    const list = LLM_MODELS_BY_PROVIDER[llmPreference];
    if (llmModelId && list.some((m) => m.id === llmModelId)) return llmModelId;
    return list[0]?.id ?? "";
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [wmEnabled, setWmEnabled] = useState(watermarkPaidEnabled);
  const [wmText, setWmText] = useState(watermarkCustomText);
  const [wmPos, setWmPos] = useState<(typeof WM_POSITIONS)[number]["id"]>(watermarkPosition);
  const [wmMsg, setWmMsg] = useState<string | null>(null);
  const [wmErr, setWmErr] = useState<string | null>(null);

  const allowed = useMemo(
    () => new Set(allowedLlmPreferencesForTier(tier, isAdmin)),
    [tier, isAdmin],
  );

  const allowsCustomization = allowed.size > 1;

  const modelList = useMemo(() => {
    if (pref === "auto") return [];
    return LLM_MODELS_BY_PROVIDER[pref];
  }, [pref]);

  const refreshCatalogMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/refresh-llm-models", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Gagal menyegarkan katalog");
      return body;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["llm-models-catalog"] });
      setMsg("Katalog model penyedia diperbarui.");
      setErr(null);
    },
    onError: (e: unknown) => {
      setErr(e instanceof Error ? e.message : "Error");
      setMsg(null);
    },
  });

  const paidWatermarkUi = tier !== "free" || isAdmin;

  const wmMutation = useMutation({
    mutationFn: async (payload: {
      enabled: boolean;
      customText: string;
      position: (typeof WM_POSITIONS)[number]["id"];
    }) => {
      setWmMsg(null);
      setWmErr(null);
      const res = await fetch("/api/me/watermark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Gagal menyimpan watermark");
    },
    onSuccess: () => {
      setWmMsg("Pengaturan watermark tersimpan.");
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      router.refresh();
    },
    onError: (e: unknown) => setWmErr(e instanceof Error ? e.message : "Error"),
  });

  const mutation = useMutation({
    mutationFn: async (payload: {
      preference: LlmProviderId;
      modelId: string | null;
    }) => {
      setMsg(null);
      setErr(null);
      const res = await fetch("/api/me/llm-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Gagal menyimpan preferensi");
    },
    onSuccess: () => {
      setMsg("Preferensi LLM tersimpan.");
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      router.refresh();
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Error"),
  });

  const tierLabel = isAdmin ? "Admin" : TIER_DETAILS[tier].label;
  const billingNote =
    isAdmin && TIER_DETAILS[tier]
      ? `Billing: ${TIER_DETAILS[tier].label} — job admin tidak mengurangi kuota/kredit.`
      : null;

  const normalizedSavedModel =
    llmPreference === "auto"
      ? ""
      : (
          llmModelId?.trim() ||
          LLM_MODELS_BY_PROVIDER[llmPreference][0]?.id ||
          ""
        ).trim();
  const normalizedCurrent =
    pref === "auto"
      ? ""
      : (modelId.trim() || modelList[0]?.id || "").trim();
  const dirty =
    pref !== llmPreference ||
    (pref !== "auto" && normalizedCurrent !== normalizedSavedModel);

  const wmDirty =
    wmEnabled !== watermarkPaidEnabled ||
    wmText.trim() !== (watermarkCustomText ?? "").trim() ||
    wmPos !== watermarkPosition;

  function onSave() {
    const mid =
      pref === "auto" ? null : modelId.trim() || modelList[0]?.id || null;
    mutation.mutate({ preference: pref, modelId: mid });
  }

  const showModelSelect =
    pref !== "auto" && isLlmPreferenceAllowedForTier(tier, isAdmin, pref);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold text-ink">Pengaturan</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Akun: {email} · Status: <strong>{tierLabel}</strong>
          {billingNote ? (
            <>
              {" "}
              <span className="text-ink-muted">({billingNote})</span>
            </>
          ) : null}
        </p>
      </section>

      <Card>
        <h2 className="text-lg font-semibold text-ink">Preferensi model AI</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {isAdmin
            ? "Admin: semua penyedia tersedia."
            : tierLlmHelpText(tier)}{" "}
          Jika bukan Auto, pilih model spesifik untuk penyedia tersebut.
        </p>
        <ul className="mt-4 space-y-2">
          {PROVIDER_OPTIONS.map((opt) => {
            const enabled = allowed.has(opt.id);
            return (
              <li key={opt.id}>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                    pref === opt.id
                      ? "border-accent bg-accent-soft"
                      : "border-edge bg-surface"
                  } ${!enabled ? "cursor-not-allowed opacity-55" : ""}`}
                >
                  <input
                    type="radio"
                    name="llm"
                    value={opt.id}
                    disabled={!enabled}
                    checked={pref === opt.id}
                    onChange={() => {
                      setPref(opt.id);
                      if (opt.id !== "auto") {
                        const first = LLM_MODELS_BY_PROVIDER[opt.id][0]?.id ?? "";
                        setModelId(first);
                      } else {
                        setModelId("");
                      }
                    }}
                    className="mt-1"
                  />
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {opt.label}
                      {opt.id !== "auto" ? (
                        <span className="ml-2 rounded-full bg-subtle px-2 py-0.5 text-[10px] font-medium uppercase text-ink-muted">
                          {providerMinimumTierLabel(
                            opt.id as Exclude<LlmProviderId, "auto">,
                          )}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-ink-muted">{opt.description}</p>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>

        {showModelSelect ? (
          <div className="mt-4 flex flex-col gap-1">
            <label htmlFor="llm-model" className="text-sm font-medium text-ink">
              Model untuk {PROVIDER_OPTIONS.find((p) => p.id === pref)?.label}
            </label>
            <select
              id="llm-model"
              className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-ink"
              value={modelId || modelList[0]?.id || ""}
              onChange={(e) => setModelId(e.target.value)}
            >
              {modelList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {catalogModelSuffix(pref, m.id, catalog)}
                </option>
              ))}
            </select>
            {pref === "openai" && catalog ? (
              (() => {
                const row = openAiMergedCatalogRow(catalog);
                if (!row.lastSuccessAt) return null;
                return (
                  <p className="text-xs text-ink-muted">
                    Sinkron API (OpenAI resmi + OpenRouter):{" "}
                    {new Date(row.lastSuccessAt).toLocaleString("id-ID")}
                    {row.fetchError
                      ? ` · peringatan: ${row.fetchError.slice(0, 140)}`
                      : ""}
                  </p>
                );
              })()
            ) : pref !== "anthropic" && pref !== "openai" && catalog?.providers[pref as CatalogProviderKey]?.lastSuccessAt ? (
              <p className="text-xs text-ink-muted">
                Sinkron API penyedia:{" "}
                {new Date(
                  catalog.providers[pref as CatalogProviderKey].lastSuccessAt!,
                ).toLocaleString("id-ID")}
                {catalog.providers[pref as CatalogProviderKey].fetchError
                  ? ` · peringatan: ${catalog.providers[pref as CatalogProviderKey].fetchError!.slice(0, 140)}`
                  : ""}
              </p>
            ) : null}
            <p className="text-xs text-ink-muted">
              Daftar pilihan mengikuti allowlist app; teks &quot;tersedia (sinkron API)&quot;
              membandingkan dengan cache hasil cek berkala ke penyedia. ID tidak dikenal
              tetap ditolak saat simpan.
            </p>
          </div>
        ) : null}

        {isAdmin ? (
          <div className="mt-6 rounded-lg border border-dashed border-edge bg-subtle/90 p-4">
            <p className="text-sm font-medium text-ink">Admin — sinkron katalog model</p>
            <p className="mt-1 text-xs text-ink-muted">
              Set <code className="rounded bg-surface px-1 text-[11px]">CRON_SECRET</code> di
              Vercel lalu jadwalkan GET{" "}
              <code className="rounded bg-surface px-1 text-[11px]">/api/cron/refresh-llm-models</code>{" "}
              (contoh: tiap jam lewat <code className="rounded bg-surface px-1 text-[11px]">web/vercel.json</code>
              ). Pastikan key Groq/Gemini/OpenAI/OpenRouter ikut di env deployment web.
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              disabled={refreshCatalogMutation.isPending}
              onClick={() => refreshCatalogMutation.mutate()}
            >
              {refreshCatalogMutation.isPending ? "Menyegarkan…" : "Segarkan katalog sekarang"}
            </Button>
          </div>
        ) : null}

        {err ? <p className="mt-3 text-sm text-red-600">{err}</p> : null}
        {msg ? <p className="mt-3 text-sm text-emerald-700">{msg}</p> : null}
        <Button
          type="button"
          variant="primary"
          className="mt-4"
          disabled={mutation.isPending || !dirty || !allowsCustomization}
          onClick={onSave}
        >
          {mutation.isPending ? "Menyimpan…" : "Simpan preferensi"}
        </Button>
        {!allowsCustomization ? (
          <p className="mt-2 text-xs text-ink-muted">
            Paket Free hanya memakai Auto — tidak ada perubahan untuk disimpan.
          </p>
        ) : null}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-ink">Watermark video</h2>
        {!paidWatermarkUi ? (
          <p className="mt-1 text-sm text-ink-muted">
            Paket Free memakai watermark ringan otomatis di sudut bawah (teks{" "}
            <span className="font-mono text-xs">Fai-Clipper</span>, tidak menutupi area wajah
            utama) — bisa diubah
            operator lewat env server{" "}
            <span className="font-mono text-xs">FREE_TIER_WATERMARK_TEXT</span>. Upgrade ke Starter
            atau lebih tinggi jika ingin menonaktifkan watermark atau memakai teks dan posisi
            kustom.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-ink-muted">
              Tier berbayar: default tanpa watermark. Aktifkan jika ingin branding kustom pada
              hasil 9:16 (teks + posisi).
            </p>
            <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={wmEnabled}
                onChange={(e) => setWmEnabled(e.target.checked)}
              />
              Aktifkan watermark kustom
            </label>
            <div className="mt-3 grid max-w-xl gap-3 text-sm">
              <label className="flex flex-col gap-1">
                <span className="text-ink-muted">Teks (maks. 120 karakter)</span>
                <input
                  className="rounded-md border border-edge px-3 py-2"
                  value={wmText}
                  onChange={(e) => setWmText(e.target.value.slice(0, 120))}
                  disabled={!wmEnabled}
                  placeholder="mis. @channel_anda"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-ink-muted">Posisi</span>
                <select
                  className="rounded-md border border-edge px-3 py-2"
                  value={wmPos}
                  disabled={!wmEnabled}
                  onChange={(e) =>
                    setWmPos(e.target.value as (typeof WM_POSITIONS)[number]["id"])
                  }
                >
                  {WM_POSITIONS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {wmErr ? <p className="mt-3 text-sm text-red-600">{wmErr}</p> : null}
            {wmMsg ? <p className="mt-3 text-sm text-emerald-700">{wmMsg}</p> : null}
            <Button
              type="button"
              variant="primary"
              className="mt-4"
              disabled={wmMutation.isPending || !wmDirty}
              onClick={() =>
                wmMutation.mutate({
                  enabled: wmEnabled,
                  customText: wmText,
                  position: wmPos,
                })
              }
            >
              {wmMutation.isPending ? "Menyimpan…" : "Simpan watermark"}
            </Button>
          </>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-ink">Keamanan akun</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Kelola password dan autentikasi tambahan. Sama untuk akun admin maupun pengguna
          biasa.
        </p>
        <ul className="mt-4 space-y-3 text-sm">
          <li>
            <Link
              href="/dashboard/settings/password"
              className="font-medium text-accent hover:underline"
            >
              Ganti password
            </Link>
            <p className="text-xs text-ink-muted">Berlaku segera setelah disimpan.</p>
          </li>
          <li>
            <Link href="/auth/forgot-password" className="font-medium text-accent hover:underline">
              Lupa password
            </Link>
            <p className="text-xs text-ink-muted">Kirim tautan reset ke email terdaftar.</p>
          </li>
          <li>
            <Link
              href="/dashboard/settings/mfa"
              className="font-medium text-accent hover:underline"
            >
              Autentikasi dua faktor (2FA / TOTP)
            </Link>
            <p className="mt-1 text-xs text-ink-muted">
              Daftarkan aplikasi authenticator di halaman khusus. Pastikan juga fitur MFA
              diaktifkan untuk project Supabase Anda (Auth → Multi-factor).
            </p>
          </li>
        </ul>
      </Card>
    </div>
  );
}
