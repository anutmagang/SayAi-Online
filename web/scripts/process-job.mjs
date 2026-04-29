/**
 * Background worker: run Python clipper for one job.
 *
 * Usage:
 *   SOURCE_URL=https://... node process-job.mjs <jobId>
 *   INPUT_FILE=/abs/path/source.mp4 node process-job.mjs <jobId>
 *   SOURCE_STORAGE_PATH=<uid>/<jobId>/<file> node process-job.mjs <jobId>
 *
 * What it does:
 *   1. Mark the job as running.
 *   2. If SOURCE_STORAGE_PATH is set, download the source from the `sources`
 *      bucket into the local job dir.
 *   3. Spawn `python -m clipper` with streaming stdout/stderr to worker.log.
 *      The Python side emits progress events via JOB_EVENTS_URL.
 *   4. Upload every rendered clip into the `clips` bucket at
 *      <userId>/<jobId>/clip_NN.mp4.
 *   5. Update the job row with the final result (clips.json contents + upload
 *      paths).
 *   6. On any failure, mark the job failed and refund 1 credit / quota.
 */
import { createClient } from "@supabase/supabase-js";
import { spawn } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * YouTube dari VPS sering butuh cookies. Kalau YTDLP_COOKIES belum di .env,
 * otomatis pakai file di lokasi standar (cukup upload cookie sekali).
 */
function applyDefaultYtdlpCookies(root) {
  if ((process.env.YTDLP_COOKIES || "").trim()) return;
  const candidates = [
    path.join(root, "secrets", "youtube-cookies.txt"),
    path.join(path.dirname(root), "secrets", "youtube-cookies.txt"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      process.env.YTDLP_COOKIES = path.resolve(p);
      return;
    }
  }
}

const jobId = process.argv[2];
const sourceUrl = process.env.SOURCE_URL?.trim() || "";
const inputFile = process.env.INPUT_FILE?.trim() || "";
const sourceStoragePath = process.env.SOURCE_STORAGE_PATH?.trim() || "";
const userId = process.env.CLIPPER_USER_ID?.trim() || "";
const userTier = process.env.USER_TIER?.trim() || "free";

const repoRoot = process.env.REPO_ROOT
  ? path.resolve(process.env.REPO_ROOT)
  : path.resolve(__dirname, "..", "..");
const webRoot = path.join(repoRoot, "web");

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(webRoot, ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

if (!jobId) {
  console.error("usage: node process-job.mjs <jobId>");
  process.exit(1);
}
if (!sourceUrl && !inputFile && !sourceStoragePath) {
  console.error("Provide one of SOURCE_URL, INPUT_FILE, or SOURCE_STORAGE_PATH");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const outRoot =
  process.env.CLIPPER_OUTPUT?.trim() || path.join(repoRoot, "output");
const jobDir = path.join(outRoot, jobId);
const logPath = path.join(jobDir, "worker.log");

async function ensureJobDir() {
  await fsp.mkdir(jobDir, { recursive: true });
}

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

async function downloadSourceFromStorage() {
  if (!sourceStoragePath) return null;
  await emitEvent("downloading", "Mengunduh sumber dari Storage", 2);
  const { data, error } = await supabase.storage
    .from("sources")
    .download(sourceStoragePath);
  if (error) throw new Error(`storage download failed: ${error.message}`);
  const ext = path.extname(sourceStoragePath).toLowerCase() || ".mp4";
  const dest = path.join(jobDir, `source${ext}`);
  const buf = Buffer.from(await data.arrayBuffer());
  await fsp.writeFile(dest, buf);
  log(`source downloaded ${buf.length} bytes -> ${dest}`);
  return dest;
}

/** Cookie YouTube per user (bucket youtube_cookies) — mengalahkan YTDLP_COOKIES server. */
async function applyUserYoutubeCookiesIfNeeded() {
  const u = sourceUrl.toLowerCase();
  const isYt = u.includes("youtube.com") || u.includes("youtu.be");
  if (!isYt || !userId) {
    return false;
  }
  const key = `${userId}/youtube-cookies.txt`;
  const { data, error } = await supabase.storage.from("youtube_cookies").download(key);
  if (error || !data) {
    log(`user youtube cookies: tidak ada (${error?.message ?? "no file"})`);
    return false;
  }
  const buf = Buffer.from(await data.arrayBuffer());
  if (buf.length < 80) {
    log("user youtube cookies: file terlalu kecil, abaikan");
    return false;
  }
  const dest = path.join(jobDir, "youtube-cookies-user.txt");
  await fsp.writeFile(dest, buf);
  process.env.YTDLP_COOKIES = dest;
  log(`user youtube cookies: ${buf.length} bytes -> ${dest}`);
  return true;
}

async function uploadClipsToStorage(resultJson) {
  const clipsPrefix = `${userId || "unknown"}/${jobId}`;
  const clips = resultJson.clips ?? [];
  const uploaded = [];
  for (let i = 0; i < clips.length; i++) {
    const localPath = path.join(jobDir, "clips", `clip_${String(i).padStart(2, "0")}.mp4`);
    if (!fs.existsSync(localPath)) continue;
    const key = `${clipsPrefix}/clip_${String(i).padStart(2, "0")}.mp4`;
    const data = await fsp.readFile(localPath);
    const { error } = await supabase.storage
      .from("clips")
      .upload(key, data, { contentType: "video/mp4", upsert: true });
    if (error) {
      log(`clip ${i} upload failed: ${error.message}`);
      continue;
    }
    uploaded.push(key);
    clips[i] = { ...clips[i], storage_path: key };
  }
  return { clipsPrefix, uploaded };
}

function runClipper(inputLocalFile, envExtra) {
  return new Promise((resolve, reject) => {
    const python = process.env.PYTHON_BIN?.trim() || "python";
    const base = ["-m", "clipper", "-o", outRoot, "--job-id", jobId];
    const args = inputLocalFile
      ? [...base, "--input", inputLocalFile]
      : [...base, sourceUrl];

    /** Supaya error_message job tidak cuma stack Node — ambil tail stderr Python. */
    const captureMax = 24_000;
    let stderrTail = "";
    const appendStderr = (chunk) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-captureMax);
    };

    const child = spawn(python, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLIPPER_OUTPUT: outRoot,
        CLIPPER_JOB_ID: jobId,
        CLIPPER_USER_ID: userId,
        USER_TIER: userTier,
        JOB_EVENTS_URL: `${supabaseUrl}/rest/v1/job_events`,
        JOB_EVENTS_TOKEN: serviceKey,
        ...envExtra,
      },
    });

    child.stdout.on("data", (d) => logStream?.write(d));
    child.stderr.on("data", (d) => {
      logStream?.write(d);
      appendStderr(d);
    });

    const timeoutSec = parseInt(process.env.PIPELINE_TIMEOUT_SEC || "3600", 10);
    const killer = setTimeout(() => {
      log(`pipeline timeout after ${timeoutSec}s, killing`);
      child.kill("SIGKILL");
    }, timeoutSec * 1000);

    child.on("error", (e) => {
      clearTimeout(killer);
      reject(e);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(killer);
      if (code === 0) resolve();
      const tail = stderrTail.trim();
      const detail = tail
        ? `\n--- clipper stderr (tail) ---\n${tail}`
        : `\n(no stderr captured; inspect ${logPath} on server)`;
      reject(new Error(`clipper exited code=${code} signal=${signal}${detail}`));
    });
  });
}

async function main() {
  await ensureJobDir();
  logStream = fs.createWriteStream(logPath, { flags: "a" });
  log(`worker start job=${jobId} tier=${userTier}`);

  await updateJob({ status: "running", error_message: null });
  await emitEvent("starting", "Memulai pipeline", 1);

  /** Tanpa ini, file `secrets/youtube-cookies.txt` di VPS tidak pernah terbaca kecuali YTDLP_COOKIES di .env. */
  applyDefaultYtdlpCookies(repoRoot);

  const systemYtCookies = (process.env.YTDLP_COOKIES || "").trim();
  const appliedUserCookies = await applyUserYoutubeCookiesIfNeeded();
  if (!appliedUserCookies && systemYtCookies) {
    process.env.YTDLP_COOKIES = systemYtCookies;
  }
  if (!appliedUserCookies && !systemYtCookies) {
    delete process.env.YTDLP_COOKIES;
  }
  log(
    `youtube cookies: ${appliedUserCookies ? "user-storage" : systemYtCookies ? "server-env" : "none"}`,
  );
  const ytc = (process.env.YTDLP_COOKIES || "").trim();
  if (ytc) {
    const abs = path.resolve(ytc);
    process.env.YTDLP_COOKIES = abs;
    try {
      const st = fs.statSync(abs);
      log(`YTDLP_COOKIES file=${abs} bytes=${st.size}`);
    } catch {
      log(`YTDLP_COOKIES file=${abs} (tidak ada atau tidak terbaca)`);
    }
  }

  const local = inputFile || (await downloadSourceFromStorage());

  await runClipper(local, {});

  const clipsJsonPath = path.join(jobDir, "clips.json");
  const raw = await fsp.readFile(clipsJsonPath, "utf-8");
  const result = JSON.parse(raw);

  await emitEvent("uploading", "Mengunggah klip ke Storage", 92);
  const { clipsPrefix } = await uploadClipsToStorage(result);

  await updateJob({
    status: "completed",
    result,
    finished_at: new Date().toISOString(),
    llm_provider_used: result.llm_provider_used ?? null,
    transcribe_provider_used: result.transcribe_provider_used ?? null,
    clips_storage_prefix: clipsPrefix,
  });
  await emitEvent("completed", "Selesai — klip siap diunduh", 100);
  log("worker done");
}

main().catch(async (e) => {
  const msg = (e instanceof Error ? e.stack || e.message : String(e)).slice(0, 4000);
  log(`worker failed: ${msg}`);
  try {
    await emitEvent("failed", e?.message ?? String(e), null);
    await updateJob({ status: "failed", error_message: msg });
    const { error: refundErr } = await supabase.rpc("refund_failed_job", {
      p_job_id: jobId,
    });
    if (refundErr) log(`refund_failed_job: ${refundErr.message}`);
    else log(`refund_failed_job ok`);
  } catch (err) {
    log(`cleanup failed: ${err?.message ?? err}`);
  }
  process.exit(1);
});
