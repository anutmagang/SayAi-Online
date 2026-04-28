import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { JobDetail, type JobPayload } from "./job-detail";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, status, job_type, source_url, error_message, result, created_at, updated_at, finished_at, tier_used, source_kind, llm_provider_used, transcribe_provider_used, clips_storage_prefix",
    )
    .eq("id", params.id)
    .single();

  if (error || !data) {
    notFound();
  }

  return (
    <Suspense fallback={<div className="p-8 text-sm text-ink-muted">Memuat job…</div>}>
      <JobDetail jobId={params.id} initial={data as JobPayload} />
    </Suspense>
  );
}

