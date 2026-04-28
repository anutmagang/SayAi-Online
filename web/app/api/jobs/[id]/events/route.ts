import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { JobEventRow } from "@/lib/types";

export const runtime = "nodejs";

/** Poll-style endpoint for the dashboard progress bar. Newest first. */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("job_events")
    .select("id, job_id, user_id, phase, message, progress, created_at")
    .eq("job_id", params.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data ?? []) as JobEventRow[]);
}
