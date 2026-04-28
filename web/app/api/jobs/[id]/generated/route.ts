import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getOutputRoot } from "@/lib/paths";

export const runtime = "nodejs";

const JOB_ID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!JOB_ID_RE.test(params.id)) return new NextResponse("Bad job id", { status: 400 });

  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, result")
    .eq("id", params.id)
    .maybeSingle();
  if (error || !job) return new NextResponse("Not found", { status: 404 });

  const generations = (job.result as { generations?: Array<{ storage_path?: string; kind?: string; mime?: string }> } | null)?.generations ?? [];
  const first = generations[0];
  const storagePath = first?.storage_path?.trim() || "";
  const kind = first?.kind === "image" ? "image" : "video";
  const mime = first?.mime || (kind === "image" ? "image/jpeg" : "video/mp4");
  if (!storagePath) return new NextResponse("No generated asset", { status: 404 });

  const url = new URL(request.url);
  const attachment = url.searchParams.get("dl") === "1";
  const fallbackName = kind === "image" ? "generated.jpg" : "generated.mp4";
  const filename = storagePath.split("/").pop() || fallbackName;

  const admin = createServiceRoleClient();
  const { data: signed, error: signErr } = await admin.storage
    .from("clips")
    .createSignedUrl(storagePath, 60 * 60, {
      download: attachment ? filename : undefined,
    });
  if (!signErr && signed?.signedUrl) {
    return NextResponse.redirect(signed.signedUrl, { status: 302 });
  }

  const local = path.join(getOutputRoot(), params.id, kind === "image" ? "generated.jpg" : "generated.mp4");
  if (!fs.existsSync(local)) return new NextResponse("Not found", { status: 404 });
  const stream = fs.createReadStream(local);
  const webStream = Readable.toWeb(stream);
  return new NextResponse(webStream as unknown as BodyInit, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": attachment
        ? `attachment; filename="${filename}"`
        : `inline; filename="${filename}"`,
    },
  });
}
