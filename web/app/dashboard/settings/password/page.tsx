import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { ChangePasswordForm } from "./change-password-form";

export const dynamic = "force-dynamic";

export default async function ChangePasswordSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("password_change_lockout_until, password_change_failures")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-8">
      <Link href="/dashboard/settings" className="text-sm font-medium text-accent hover:underline">
        ← Kembali ke pengaturan
      </Link>
      <Card className="p-6">
        <h1 className="text-xl font-semibold text-ink">Ganti password</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Verifikasi password lama, lalu setel password baru untuk{" "}
          <span className="font-medium">{user.email}</span>.
        </p>
        <ChangePasswordForm
          userEmail={user.email ?? ""}
          lockoutUntil={(profile?.password_change_lockout_until as string | null) ?? null}
          failureCount={Number(profile?.password_change_failures ?? 0)}
        />
      </Card>
    </div>
  );
}
