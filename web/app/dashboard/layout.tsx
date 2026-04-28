import { redirect } from "next/navigation";
import Link from "next/link";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { createClient } from "@/lib/supabase/server";
import { CreditsStrip } from "./credits-strip";
import { SignOutButton } from "./sign-out-button";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  const isAdmin = Boolean(profile?.is_admin);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 border-b border-edge bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3.5 sm:px-6">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
            <Link
              href="/dashboard"
              className="shrink-0 text-lg font-semibold tracking-tight text-ink"
            >
              Fai-Clipper
            </Link>
            <nav className="hidden flex-wrap items-center gap-1 text-sm text-ink-muted sm:flex">
              <Link
                href="/dashboard"
                className="rounded-lg px-2.5 py-1.5 transition hover:bg-subtle hover:text-ink"
              >
                Job
              </Link>
              <Link
                href="/dashboard/analytics"
                className="rounded-lg px-2.5 py-1.5 transition hover:bg-subtle hover:text-ink"
              >
                Analitik
              </Link>
              <Link
                href="/dashboard/upgrade"
                className="rounded-lg px-2.5 py-1.5 transition hover:bg-subtle hover:text-ink"
              >
                Upgrade
              </Link>
              <Link
                href="/dashboard/topup"
                className="rounded-lg px-2.5 py-1.5 transition hover:bg-subtle hover:text-ink"
              >
                Top-up
              </Link>
              <Link
                href="/dashboard/settings"
                className="rounded-lg px-2.5 py-1.5 transition hover:bg-subtle hover:text-ink"
              >
                Settings
              </Link>
              {isAdmin ? (
                <Link
                  href="/dashboard/admin"
                  className="rounded-lg px-2.5 py-1.5 font-medium text-amber-800 transition hover:bg-amber-500/10"
                >
                  Admin
                </Link>
              ) : null}
              <span className="text-ink-muted/40">|</span>
              <span className="max-w-[200px] truncate text-xs text-ink-muted">{user.email}</span>
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeSwitcher compact />
            <SignOutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-6">
        <CreditsStrip />
        {children}
      </div>
    </div>
  );
}
