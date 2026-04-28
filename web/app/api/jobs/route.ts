import { spawn } from "child_process";
import path from "path";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOutputRoot, getRepoRoot } from "@/lib/paths";
import { createJobPostBodySchema } from "@/app/api/jobs/body-schema";
import { maxClipsAllowedForTier, type Tier } from "@/lib/tiers";

export const runtime = "nodejs";

type StartClipJobRow = {
  job_id: string;
  tier: "free" | "starter" | "creator" | "pro";
  llm_preference: "auto" | "groq" | "gemini" | "openai" | "anthropic";
  llm_model_id: string | null;
  worker_tier: "free" | "starter" | "creator" | "pro";
  watermark_paid_enabled?: boolean;
  watermark_custom_text?: string | null;
  watermark_position?: string | null;
  used_credit_fallback?: boolean;
};

function spawnWorker(
  jobId: string,
  envExtra: Record<string, string | undefined>,
) {
  const repoRoot = getRepoRoot();
  const outputRoot = getOutputRoot();
  const pythonBin = process.env.PYTHON_BIN?.trim() || "python";
  const scriptPath = path.join(process.cwd(), "scripts", "process-job.mjs");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const child = spawn(process.execPath, [scriptPath, jobId], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      REPO_ROOT: repoRoot,
      CLIPPER_OUTPUT: outputRoot,
      PYTHON_BIN: pythonBin,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      SOURCE_URL: "",
      INPUT_FILE: "",
      SOURCE_STORAGE_PATH: "",
      ...envExtra,
    },
  });
  child.unref();
}

function mapStartJobError(message: string): { status: number; body: string } | null {
  if (message.includes("INSUFFICIENT_CREDITS")) {
    return {
      status: 402,
      body: "Kredit tidak cukup. Ajukan top-up atau upgrade subscription.",
    };
  }
  if (message.includes("MONTHLY_QUOTA_EXHAUSTED")) {
    return {
      status: 402,
      body:
        "Kuota bulanan habis dan kredit tidak cukup. Top-up kredit, tunggu reset kuota, atau upgrade paket.",
    };
  }
  if (message.includes("TOO_MANY_ACTIVE_JOBS")) {
    return {
      status: 429,
      body: "Maksimal 3 job berjalan bersamaan. Tunggu salah satu selesai.",
    };
  }
  if (message.includes("NOT_AUTHENTICATED")) {
    return { status: 401, body: "Unauthorized" };
  }
  if (
    message.includes("does not exist") &&
    (message.includes("watermark") || message.includes("profiles"))
  ) {
    return {
      status: 503,
      body:
        "Kolom watermark pada profil belum ada di database. Jalankan migrasi Supabase terbaru (mis. 015 + 020).",
    };
  }
  return null;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("jobs")
    .select("id, status, job_type, source_url, created_at, updated_at, tier_used, source_kind")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json(
      { error: "Server misconfigured: Supabase env vars missing" },
      { status: 500 },
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("tier")
    .eq("user_id", user.id)
    .maybeSingle();

  const userTier: Tier =
    profile?.tier === "starter" ||
    profile?.tier === "creator" ||
    profile?.tier === "pro" ||
    profile?.tier === "free"
      ? profile.tier
      : "free";

  const maxClipsForTier = maxClipsAllowedForTier(userTier);
  const bodySchema = createJobPostBodySchema(maxClipsForTier);

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload tidak valid", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const rpcArgs =
    parsed.data.kind === "url"
      ? { p_source_url: parsed.data.url, p_source_kind: "url", p_source_storage_path: null }
      : {
          p_source_url: `upload:${parsed.data.originalName ?? path.basename(parsed.data.storagePath)}`,
          p_source_kind: "upload",
          p_source_storage_path: parsed.data.storagePath,
        };

  const { data, error: rpcErr } = await supabase.rpc("start_clip_job", rpcArgs);
  if (rpcErr) {
    const mapped = mapStartJobError(rpcErr.message ?? "");
    if (mapped) {
      return NextResponse.json({ error: mapped.body }, { status: mapped.status });
    }
    return NextResponse.json(
      { error: rpcErr.message ?? "Gagal membuat job" },
      { status: 500 },
    );
  }

  const row = Array.isArray(data) ? (data[0] as StartClipJobRow | undefined) : undefined;
  if (!row?.job_id) {
    return NextResponse.json({ error: "Gagal membuat job" }, { status: 500 });
  }

  const workerTier = row.worker_tier ?? row.tier;
  const jobTier = row.tier;
  const isFreeJob = jobTier === "free";
  const workerEnv: Record<string, string> = {
    CLIPPER_USER_ID: user.id,
    USER_TIER: workerTier,
    LLM_PREFERENCE: row.llm_preference,
  };
  const freeWm =
    process.env.FREE_TIER_WATERMARK_TEXT?.trim() || "Fai-Clipper";
  workerEnv.FREE_TIER_WATERMARK_TEXT = freeWm;
  if (isFreeJob) {
    workerEnv.WATERMARK_PAID_ENABLED = "false";
    workerEnv.WATERMARK_CUSTOM_TEXT = "";
    /* Sudut bawah kanan: tidak menutupi wajah utama, minim ganggu konten berhak cipta user. */
    workerEnv.WATERMARK_POSITION =
      process.env.FREE_TIER_WATERMARK_POSITION?.trim() || "bottom_right";
  } else {
    workerEnv.WATERMARK_PAID_ENABLED = row.watermark_paid_enabled ? "true" : "false";
    workerEnv.WATERMARK_CUSTOM_TEXT = (row.watermark_custom_text ?? "").trim();
    workerEnv.WATERMARK_POSITION = (
      row.watermark_position?.trim() ||
      process.env.WATERMARK_POSITION?.trim() ||
      "bottom_right"
    );
  }
  if (row.llm_model_id?.trim()) {
    workerEnv.LLM_MODEL_ID = row.llm_model_id.trim();
  }
  if (parsed.data.maxClips != null) {
    workerEnv.MAX_CLIPS = String(parsed.data.maxClips);
  }
  const clipMin = parsed.data.clipMinDurationSec ?? 20;
  const clipMax = parsed.data.clipMaxDurationSec ?? 90;
  workerEnv.CLIP_MIN_DURATION = String(clipMin);
  workerEnv.CLIP_MAX_DURATION = String(clipMax);
  if (parsed.data.kind === "url") {
    workerEnv.SOURCE_URL = parsed.data.url;
  } else {
    workerEnv.SOURCE_STORAGE_PATH = parsed.data.storagePath;
  }
  const outputLayout = parsed.data.outputLayout ?? "short_vertical";
  workerEnv.CLIPPER_OUTPUT_LAYOUT = outputLayout;
  spawnWorker(row.job_id, workerEnv);

  return NextResponse.json({
    jobId: row.job_id,
    tier: row.tier,
    usedCreditFallback: Boolean(row.used_credit_fallback),
  });
}

