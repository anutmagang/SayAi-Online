import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getOutputRoot } from "@/lib/paths";

export const runtime = "nodejs";

const JOB_ID_RE = /^[0-9a-f-]{36}$/i;
const CLIP_RE = /^\d{2}$/;

/** Redirect to a short-lived Storage signed URL when the clip was uploaded;
 *  fall back to streaming the local file (useful for dev without Storage).
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string; clip: string } },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  if (!JOB_ID_RE.test(params.id)) {
    return new NextResponse("Bad job id", { status: 400 });
  }
  if (!CLIP_RE.test(params.clip)) {
    return new NextResponse("Bad clip id", { status: 400 });
  }

  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, clips_storage_prefix, result")
    .eq("id", params.id)
    .maybeSingle();
  if (error || !job) return new NextResponse("Not found", { status: 404 });

  const url = new URL(request.url);
  const attachment = url.searchParams.get("dl") === "1";
  const clipFile = `clip_${params.clip}.mp4`;

  const prefix = (job.clips_storage_prefix ?? "").trim();
  if (prefix) {
    const admin = createServiceRoleClient();
    const { data: signed, error: signErr } = await admin.storage
      .from("clips")
      .createSignedUrl(`${prefix}/${clipFile}`, 60 * 60, {
        download: attachment ? clipFile : undefined,
      });
    if (!signErr && signed?.signedUrl) {
      return NextResponse.redirect(signed.signedUrl, { status: 302 });
    }
  }

  // Fallback: local file (dev / migration grace).
  const filePath = path.join(getOutputRoot(), params.id, "clips", clipFile);
  const resolved = path.resolve(filePath);
  const rootResolved = path.resolve(getOutputRoot(), params.id, "clips");
  const rel = path.relative(rootResolved, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return new NextResponse("Invalid path", { status: 400 });
  }
  if (!fs.existsSync(resolved)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const stream = fs.createReadStream(resolved);
  const webStream = Readable.toWeb(stream);
  return new NextResponse(webStream as unknown as BodyInit, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": attachment
        ? `attachment; filename="${clipFile}"`
        : `inline; filename="${clipFile}"`,
    },
  });
}
