import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ClipMeta = { viral_score?: number };

type JobResult = {
  clips?: ClipMeta[];
  phase4?: { viral_model?: string };
} | null;

function aggregateViral(results: JobResult[]): {
  avg: number | null;
  max: number | null;
  clipCount: number;
} {
  const scores: number[] = [];
  for (const r of results) {
    const clips = r?.clips ?? [];
    for (const c of clips) {
      if (typeof c.viral_score === "number") {
        scores.push(c.viral_score);
      }
    }
  }
  if (!scores.length) {
    return { avg: null, max: null, clipCount: 0 };
  }
  const sum = scores.reduce((a, b) => a + b, 0);
  return {
    avg: Math.round((sum / scores.length) * 10) / 10,
    max: Math.max(...scores),
    clipCount: scores.length,
  };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await supabase.rpc("ensure_user_profile");

  const { data: jobs, error: jobsErr } = await supabase
    .from("jobs")
    .select("id, status, result, created_at")
    .order("created_at", { ascending: false });

  if (jobsErr) {
    return NextResponse.json({ error: jobsErr.message }, { status: 500 });
  }

  const rows = jobs ?? [];
  const counts: Record<string, number> = {};
  for (const j of rows) {
    counts[j.status] = (counts[j.status] ?? 0) + 1;
  }

  const viral = aggregateViral(rows.map((j) => j.result as JobResult));

  const { count: pendingTopups, error: topErr } = await supabase
    .from("topup_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "pending");

  if (topErr) {
    return NextResponse.json({ error: topErr.message }, { status: 500 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("tier, credits_balance")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    jobTotal: rows.length,
    jobCountsByStatus: counts,
    viral: {
      avgScore: viral.avg,
      maxScore: viral.max,
      clipsScored: viral.clipCount,
    },
    topupsPending: pendingTopups ?? 0,
    credits: profile
      ? { tier: profile.tier, balance: profile.credits_balance }
      : null,
  });
}
