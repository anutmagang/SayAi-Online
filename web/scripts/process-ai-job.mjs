import { createClient } from "@supabase/supabase-js";
import { spawn } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { generateWithMock } from "./ai-providers/mock-provider.mjs";
import { tryGenerateWithOpenRouter } from "./ai-providers/openrouter-provider.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jobId = process.argv[2];
const repoRoot = process.env.REPO_ROOT
  ? path.resolve(process.env.REPO_ROOT)
  : path.resolve(__dirname, "..", "..");
const webRoot = path.join(repoRoot, "web");
const outRoot = process.env.CLIPPER_OUTPUT?.trim() || path.join(repoRoot, "output");
const jobDir = path.join(outRoot, jobId || "unknown");
const logPath = path.join(jobDir, "worker.log");
const userId = process.env.CLIPPER_USER_ID?.trim() || "";

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(webRoot, ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!jobId || !supabaseUrl || !serviceKey) {
  console.error("usage/env error: process-ai-job.mjs <jobId>");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let logStream;
function log(line) {
  const s = `[${new Date().toISOString()}] ${line}\n`;
  if (logStream) logStream.write(s);
  process.stdout.write(s);
}

async function emitEvent(phase, message, progress) {
  try {
    await supabase.from("job_events").insert({
      job_id: jobId,
      user_id: userId,
      phase,
      message: (message || "").slice(0, 500),
      progress: progress == null ? null : Math.min(100, Math.max(0, progress)),
    });
  } catch (e) {
    log(`emitEvent failed: ${e?.message ?? e}`);
  }
}

async function updateJob(patch) {
  const { error } = await supabase
    .from("jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) log(`job update failed: ${error.message}`);
}

function ffmpegEscapeText(raw) {
  return String(raw ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function sizeForAspectRatio(ar) {
  switch (ar) {
    case "9:16":
      return { w: 1080, h: 1920 };
    case "16:9":
      return { w: 1920, h: 1080 };
    case "4:3":
      return { w: 1440, h: 1080 };
    case "3:4":
      return { w: 1080, h: 1440 };
    default:
      return { w: 1024, h: 1024 };
  }
}

async function runFfmpeg(args) {
  await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { cwd: jobDir });
    child.stdout.on("data", (d) => logStream?.write(d));
    child.stderr.on("data", (d) => logStream?.write(d));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed code=${code}`));
    });
  });
}

async function uploadGenerated(localPath, ext) {
  const key = `${userId || "unknown"}/${jobId}/generated.${ext}`;
  const mime = ext === "jpg" ? "image/jpeg" : "video/mp4";
  const bin = await fsp.readFile(localPath);
  const { error } = await supabase.storage
    .from("clips")
    .upload(key, bin, { upsert: true, contentType: mime });
  if (error) throw new Error(`upload failed: ${error.message}`);
  return { key, mime };
}

async function providerOrder() {
  const envOrder = (process.env.AI_PROVIDER_ORDER || "").trim();
  if (envOrder) {
    return envOrder.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  const { data } = await supabase
    .from("ai_provider_config")
    .select("provider, enabled, priority")
    .eq("enabled", true)
    .order("priority", { ascending: true });
  const dbOrder = (data || []).map((r) => String(r.provider || "").toLowerCase()).filter(Boolean);
  return dbOrder.length ? dbOrder : ["openrouter", "mock"];
}

async function callProviderWithFallback(opts) {
  const order = await providerOrder();
  let lastErr;
  for (const p of order) {
    try {
      await emitEvent("provider_submit", `Provider: ${p}`, 18);
      if (p === "openrouter") {
        return await tryGenerateWithOpenRouter(opts);
      }
      if (p === "mock") {
        return await generateWithMock(opts);
      }
      throw new Error(`unknown provider ${p}`);
    } catch (e) {
      lastErr = e;
      log(`provider ${p} failed: ${e?.message ?? e}`);
      await emitEvent("provider_fallback", `Provider ${p} gagal, coba fallback`, 24);
    }
  }
  throw lastErr || new Error("No provider available");
}

async function materializeFfmpegArtifact(opts) {
  const ar = opts.aspectRatio || "1:1";
  const prompt = (opts.prompt || "AI generated content").slice(0, 140);
  const { w, h } = sizeForAspectRatio(ar);
  const font = process.env.FFMPEG_DRAW_TEXT_FONT?.trim() || "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
  const escaped = ffmpegEscapeText(prompt);

  if (opts.kind === "image_gen") {
    const out = path.join(jobDir, "generated.jpg");
    const vf = `drawtext=fontfile=${ffmpegEscapeText(font)}:text='${escaped}':fontcolor=white:fontsize=${Math.max(24, Math.floor(h * 0.035))}:x=(w-tw)/2:y=(h-th)/2:box=1:boxcolor=black@0.35:boxborderw=16`;
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", `color=c=0x111827:s=${w}x${h}:d=1`,
      "-vf", vf, "-frames:v", "1", out,
    ]);
    return {
      localPath: out,
      ext: "jpg",
      kind: "image",
      width: w,
      height: h,
      durationSec: undefined,
    };
  }

  const durationSec = Math.max(2, Math.min(12, Number(opts.durationSec || 4)));
  const out = path.join(jobDir, "generated.mp4");
  const vf = `drawtext=fontfile=${ffmpegEscapeText(font)}:text='${escaped}':fontcolor=white:fontsize=${Math.max(24, Math.floor(h * 0.035))}:x=(w-tw)/2:y=(h-th)/2:box=1:boxcolor=black@0.35:boxborderw=16`;
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", `color=c=0x0f172a:s=${w}x${h}:r=30`,
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
    "-t", String(durationSec),
    "-vf", vf,
    "-shortest",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-movflags", "+faststart",
    out,
  ]);
  return {
    localPath: out,
    ext: "mp4",
    kind: "video",
    width: w,
    height: h,
    durationSec,
  };
}

async function main() {
  await fsp.mkdir(jobDir, { recursive: true });
  logStream = fs.createWriteStream(logPath, { flags: "a" });

  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, job_type, ai_prompt, ai_model, ai_aspect_ratio, ai_duration_sec")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job) throw new Error("AI job not found");

  await updateJob({ status: "running", error_message: null });
  await emitEvent("queued", "Job masuk antrean AI worker", 1);
  await emitEvent("starting", "Memulai AI generator", 6);

  const request = {
    kind: job.job_type,
    prompt: job.ai_prompt || "AI generated content",
    model: job.ai_model || "fast",
    aspectRatio: job.ai_aspect_ratio || "1:1",
    durationSec: Number(job.ai_duration_sec || 4),
  };

  await emitEvent("provider_poll", "Menunggu provider menyiapkan output", 30);

  let providerResult;
  let retries = 0;
  while (retries <= 1) {
    try {
      providerResult = await callProviderWithFallback(request);
      break;
    } catch (e) {
      retries += 1;
      if (retries > 1) throw e;
      await emitEvent("provider_retry", "Provider gagal, retry sekali", 34);
    }
  }

  await emitEvent("rendering", "Materialisasi output", 56);

  let generated;
  // Phase-3 adapter contract: if provider gives direct URL/base64, can be handled here.
  // For now we consistently materialize via ffmpeg to keep deterministic output shape.
  generated = await materializeFfmpegArtifact(request);

  await emitEvent("uploading", "Mengunggah hasil ke Storage", 84);
  const up = await uploadGenerated(generated.localPath, generated.ext);

  const result = {
    job_type: request.kind,
    ai: {
      prompt: request.prompt,
      model: request.model,
      aspect_ratio: request.aspectRatio,
      duration_sec: request.kind === "video_gen" ? generated.durationSec : undefined,
    },
    provider: {
      used: providerResult?.provider || "mock",
      retries,
      fallback_order: await providerOrder(),
    },
    generations: [
      {
        kind: generated.kind,
        mime: up.mime,
        storage_path: up.key,
        width: generated.width,
        height: generated.height,
        duration_sec: generated.durationSec,
      },
    ],
    clips: [],
  };

  await updateJob({`n    status: "completed",`n    result,`n    ai_provider_used: result.provider?.used || "mock",`n    ai_cost_breakdown: { retries: result.provider?.retries ?? 0 },`n    finished_at: new Date().toISOString(),`n  });
  await emitEvent("completed", "AI generator selesai", 100);
}

main().catch(async (e) => {
  const msg = (e instanceof Error ? e.stack || e.message : String(e)).slice(0, 4000);
  log(`worker failed: ${msg}`);
  try {
    await emitEvent("failed", e?.message ?? String(e), null);
    await updateJob({ status: "failed", error_message: msg });
    const { error } = await supabase.rpc("refund_failed_job", { p_job_id: jobId });
    if (error) log(`refund_failed_job: ${error.message}`);
  } catch (err) {
    log(`cleanup failed: ${err?.message ?? err}`);
  }
  process.exit(1);
});


