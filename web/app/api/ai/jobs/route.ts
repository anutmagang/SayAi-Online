import { spawn } from "child_process";
import path from "path";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOutputRoot, getRepoRoot } from "@/lib/paths";

type StartAiJobRow = {
  job_id: string;
  tier: "free" | "starter" | "creator" | "pro";
  worker_tier: "free" | "starter" | "creator" | "pro";
  cost_credits: number;
  reused_existing: boolean;
};

export const runtime = "nodejs";

const bodySchema = z.object({
  kind: z.enum(["image_gen", "video_gen"]),
  prompt: z.string().min(3).max(2000),
  model: z.string().max(120).optional(),
  aspectRatio: z.enum(["1:1", "9:16", "16:9", "4:3", "3:4"]).default("1:1"),
  durationSec: z.coerce.number().int().min(2).max(12).optional(),
  idempotencyKey: z.string().max(120).optional(),
});

function spawnAiWorker(jobId: string, envExtra: Record<string, string | undefined>) {
  const repoRoot = getRepoRoot();
  const outputRoot = getOutputRoot();
  const scriptPath = path.join(process.cwd(), "scripts", "process-ai-job.mjs");

  const child = spawn(process.execPath, [scriptPath, jobId], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      REPO_ROOT: repoRoot,
      CLIPPER_OUTPUT: outputRoot,
      SOURCE_URL: "",
      INPUT_FILE: "",
      SOURCE_STORAGE_PATH: "",
      ...envExtra,
    },
  });
  child.unref();
}

function mapStartAiError(message: string): { status: number; body: string } | null {
  if (message.includes("INSUFFICIENT_CREDITS")) {
    return { status: 402, body: "Kredit tidak cukup untuk AI generator." };
  }
  if (message.includes("TOO_MANY_ACTIVE_JOBS")) {
    return { status: 429, body: "Maksimal 3 job aktif. Tunggu salah satu selesai." };
  }
  if (message.includes("INVALID_")) {
    return { status: 400, body: "Parameter AI generator tidak valid." };
  }
  if (message.includes("NOT_AUTHENTICATED")) {
    return { status: 401, body: "Unauthorized" };
  }
  return null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload AI generator tidak valid", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const idem = parsed.data.idempotencyKey?.trim() || randomUUID();
  const { data, error } = await supabase.rpc("start_ai_job", {
    p_job_type: parsed.data.kind,
    p_prompt: parsed.data.prompt,
    p_model: parsed.data.model?.trim() || null,
    p_aspect_ratio: parsed.data.aspectRatio,
    p_duration_sec: parsed.data.kind === "video_gen" ? parsed.data.durationSec ?? 4 : null,
    p_idempotency_key: idem,
  });
  if (error) {
    const mapped = mapStartAiError(error.message ?? "");
    if (mapped) return NextResponse.json({ error: mapped.body }, { status: mapped.status });
    return NextResponse.json({ error: error.message ?? "Gagal membuat AI job" }, { status: 500 });
  }

  const row = Array.isArray(data) ? (data[0] as StartAiJobRow | undefined) : undefined;
  if (!row?.job_id) {
    return NextResponse.json({ error: "Gagal membuat AI job" }, { status: 500 });
  }

  if (!row.reused_existing) {
    spawnAiWorker(row.job_id, {
      CLIPPER_JOB_ID: row.job_id,
      CLIPPER_USER_ID: user.id,
      USER_TIER: row.worker_tier ?? row.tier,
    });
  }

  return NextResponse.json({
    jobId: row.job_id,
    tier: row.tier,
    costCredits: row.cost_credits,
    reusedExisting: Boolean(row.reused_existing),
    idempotencyKey: idem,
  });
}
