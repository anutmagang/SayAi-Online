import archiver from "archiver";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getOutputRoot } from "@/lib/paths";
import type { JobResult } from "@/lib/types";

export const runtime = "nodejs";

/** Stream a ZIP of every clip in the job to the client.
 *  Prefers Storage-hosted clips (downloads via signed URLs on the server side);
 *  falls back to local files if the worker hasn't uploaded them yet.
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, result, clips_storage_prefix, status")
    .eq("id", params.id)
    .maybeSingle();
  if (error || !job) return new NextResponse("Not found", { status: 404 });
  if (job.status !== "completed") {
    return new NextResponse("Job belum selesai", { status: 409 });
  }

  const result = job.result as JobResult | null;
  if (!result?.clips?.length) {
    return new NextResponse("Tidak ada klip", { status: 404 });
  }

  const zip = archiver("zip", { zlib: { level: 6 } });
  const nodeReadable = Readable.toWeb(zip) as unknown as ReadableStream;

  const admin = job.clips_storage_prefix ? createServiceRoleClient() : null;
  const prefix = (job.clips_storage_prefix ?? "").trim();

  (async () => {
    for (let i = 0; i < result.clips.length; i++) {
      const name = `clip_${String(i).padStart(2, "0")}.mp4`;
      try {
        if (prefix && admin) {
          const { data, error: dlErr } = await admin.storage
            .from("clips")
            .download(`${prefix}/${name}`);
          if (!dlErr && data) {
            const buf = Buffer.from(await data.arrayBuffer());
            zip.append(buf, { name });
            continue;
          }
        }
        const localPath = path.join(getOutputRoot(), params.id, "clips", name);
        if (fs.existsSync(localPath)) {
          zip.append(fs.createReadStream(localPath), { name });
        }
      } catch (e) {
        console.error(`zip append ${name} failed`, e);
      }
    }
    zip.finalize().catch((e) => console.error("zip finalize failed", e));
  })();

  return new NextResponse(nodeReadable as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="clips-${params.id}.zip"`,
    },
  });
}
