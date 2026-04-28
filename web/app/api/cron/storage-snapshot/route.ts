import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/llm-catalog-refresh";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function parseUsdPerGb(): number {
  const raw = process.env.SUPABASE_STORAGE_USD_PER_GB?.trim();
  const n = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return 0.021;
  return n;
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json({ error: "CRON_SECRET tidak di-set." }, { status: 503 });
  }
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleClient();

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  await admin.from("platform_storage_snapshots").delete().lt("taken_at", fourteenDaysAgo);

  const { data: bucketJson, error: rpcErr } = await admin.rpc("operator_storage_bucket_bytes");
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  const obj = (bucketJson ?? {}) as Record<string, unknown>;
  let totalNum = 0;
  const normalized: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) {
    let n = 0;
    if (typeof v === "number" && Number.isFinite(v)) n = Math.round(v);
    else if (typeof v === "string") n = Math.round(Number(v)) || 0;
    else if (v && typeof v === "object" && "bytes" in (v as object)) {
      const b = (v as { bytes?: unknown }).bytes;
      n = typeof b === "number" ? Math.round(b) : 0;
    }
    normalized[k] = n;
    totalNum += n;
  }
  const gb = totalNum / 1024 ** 3;
  const usdPerGb = parseUsdPerGb();
  const costEst = gb * usdPerGb;

  const workerDiskRaw = process.env.WORKER_DISK_USAGE_BYTES?.trim();
  const workerDisk = workerDiskRaw ? Math.max(0, Math.round(Number(workerDiskRaw))) : null;

  const { error: insErr } = await admin.from("platform_storage_snapshots").insert({
    bucket_bytes: normalized,
    total_bytes: totalNum,
    worker_disk_bytes_est: workerDisk,
    storage_cost_usd_est: Number(costEst.toFixed(6)),
    notes: "supabase_storage_objects_aggregate",
  });

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    total_bytes: totalNum,
    buckets: normalized,
    storage_cost_usd_est: costEst,
  });
}
