/**
 * Retention job — delete Fai-Clipper jobs older than RETENTION_DAYS and purge
 * their Supabase Storage objects (sources + clips).
 *
 * Usage (cron, VPS): run once a day at off-peak hours.
 *   0 3 * * *  node /opt/fai-clipper/web/scripts/purge-old-jobs.mjs >> /var/log/fai-clipper-retention.log 2>&1
 *
 * Requires the same env as the worker:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 * Optional:
 *   RETENTION_DAYS (default 10)
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import fsp from "fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(webRoot, "..");

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(webRoot, ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const days = Number(process.env.RETENTION_DAYS ?? "10");
if (!Number.isFinite(days) || days < 1) {
  console.error(`invalid RETENTION_DAYS=${process.env.RETENTION_DAYS}`);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log(
    `[${new Date().toISOString()}] purge-old-jobs: retention=${days} days`,
  );

  const { data, error } = await supabase.rpc("purge_old_jobs", { p_days: days });
  if (error) {
    console.error("purge_old_jobs RPC failed:", error.message);
    process.exit(1);
  }
  const rows = data ?? [];
  console.log(`deleted ${rows.length} job rows from DB`);

  let sourceFiles = 0;
  let clipFiles = 0;

  for (const r of rows) {
    if (r.source_storage_path) {
      const { error: e } = await supabase.storage
        .from("sources")
        .remove([r.source_storage_path]);
      if (e) console.warn(`source ${r.source_storage_path}: ${e.message}`);
      else sourceFiles += 1;
    }
    if (r.clips_storage_prefix) {
      const { data: list, error: listErr } = await supabase.storage
        .from("clips")
        .list(r.clips_storage_prefix, { limit: 200 });
      if (listErr) {
        console.warn(`list ${r.clips_storage_prefix}: ${listErr.message}`);
        continue;
      }
      const keys = (list ?? []).map((o) => `${r.clips_storage_prefix}/${o.name}`);
      if (keys.length) {
        const { error: rmErr } = await supabase.storage
          .from("clips")
          .remove(keys);
        if (rmErr) console.warn(`remove clips: ${rmErr.message}`);
        else clipFiles += keys.length;
      }
    }

    // Best-effort local cleanup (dev / single-host deployments).
    const outRoot =
      process.env.CLIPPER_OUTPUT?.trim() || path.join(repoRoot, "output");
    const jobDir = path.join(outRoot, r.job_id);
    try {
      if (fs.existsSync(jobDir)) {
        await fsp.rm(jobDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn(`local cleanup ${jobDir}: ${e?.message ?? e}`);
    }
  }

  console.log(
    `purged ${sourceFiles} source files + ${clipFiles} clip files from Storage`,
  );
}

main().catch((e) => {
  console.error("purge-old-jobs crashed:", e);
  process.exit(1);
});
