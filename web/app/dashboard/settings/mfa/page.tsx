import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { MfaSettingsClient } from "./mfa-settings-client";

export const dynamic = "force-dynamic";

export default async function MfaSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-8">
      <Link href="/dashboard/settings" className="text-sm font-medium text-accent hover:underline">
        ← Kembali ke pengaturan
      </Link>
      <Card className="p-6">
        <h1 className="text-xl font-semibold text-ink">Autentikasi dua faktor (2FA)</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Akun: <span className="font-medium">{user.email}</span>
        </p>
        <div className="mt-6">
          <MfaSettingsClient />
        </div>
      </Card>
    </div>
  );
}
