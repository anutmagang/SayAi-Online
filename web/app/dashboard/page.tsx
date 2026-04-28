import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sourceDurationHintForAccount, type Tier } from "@/lib/tiers";
import type { JobRow } from "@/lib/types";
import { JobsList } from "./jobs-list";
import { AIGeneratorForm } from "./ai-generator-form";
import { NewJobForm } from "./new-job-form";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data }, { data: profile }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, status, job_type, source_url, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("tier, is_admin, monthly_quota, monthly_used, credits_balance")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const initialJobs = (data ?? []) as JobRow[];
  const userTierRaw: Tier =
    profile?.tier === "starter" ||
    profile?.tier === "creator" ||
    profile?.tier === "pro" ||
    profile?.tier === "free"
      ? profile.tier
      : "free";
  const isAdmin = Boolean(profile?.is_admin);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-semibold text-ink">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Tempel URL (mis. YouTube) atau unggah file video lokal untuk membuat klip
          otomatis. {sourceDurationHintForAccount(userTierRaw, isAdmin)}
        </p>
        <div className="mt-6 max-w-2xl space-y-4">
          <NewJobForm
            durationHint={sourceDurationHintForAccount(userTierRaw, isAdmin)}
            userTier={userTierRaw}
            isAdmin={isAdmin}
            monthlyQuota={profile?.monthly_quota ?? 0}
            monthlyUsed={profile?.monthly_used ?? 0}
            creditsBalance={profile?.credits_balance ?? 0}
          />
          <AIGeneratorForm />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-ink">Riwayat job</h2>
        <JobsList initialJobs={initialJobs} />
      </section>
    </div>
  );
}
