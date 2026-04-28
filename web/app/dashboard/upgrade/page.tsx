import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UpgradeClient } from "./upgrade-client";

export const dynamic = "force-dynamic";

export default async function UpgradePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("tier, plan_expires_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: requests } = await supabase
    .from("subscription_requests")
    .select(
      "id, requested_tier, months, status, payment_note, bank_reference, admin_note, created_at, reviewed_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <UpgradeClient
      currentTier={(profile?.tier as "free" | "starter" | "creator" | "pro") ?? "free"}
      planExpiresAt={profile?.plan_expires_at ?? null}
      requests={(requests as never) ?? []}
    />
  );
}
