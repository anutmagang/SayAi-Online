"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { SocialLinks } from "@/components/social-links";
import { ThemeSwitcher } from "@/components/theme-switcher";

type MarketingShellProps = {
  children: ReactNode;
  /** `true` = kontainer sempit (form login/dll.) */
  narrow?: boolean;
};

export function MarketingShell({ children, narrow }: MarketingShellProps) {
  const max = narrow ? "max-w-md" : "max-w-6xl";
  return (
    <div className="relative min-h-screen bg-canvas text-ink">
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-b from-accent-soft/25 to-transparent" />
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-5 sm:px-6">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight text-ink hover:text-accent"
        >
          Fai-Clipper
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ThemeSwitcher compact />
          <nav className="flex flex-wrap items-center justify-end gap-1 text-sm">
            <Link
              href="/pricing"
              className="rounded-lg px-3 py-2 text-ink-muted transition hover:bg-subtle hover:text-ink"
            >
              Harga
            </Link>
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-ink-muted transition hover:bg-subtle hover:text-ink"
            >
              Masuk
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-accent px-4 py-2 font-medium text-white shadow-lg shadow-black/10 transition hover:opacity-95"
            >
              Daftar
            </Link>
          </nav>
        </div>
      </header>

      <div className={`relative z-10 mx-auto ${max} px-5 pb-24 pt-4 sm:px-6 sm:pt-8`}>
        {children}
      </div>

      <footer className="relative z-10 border-t border-edge bg-surface/40">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-8 text-xs text-ink-muted sm:px-6 md:flex-row md:flex-wrap md:items-start md:justify-between">
          <div className="flex flex-col gap-3">
            <span>© {new Date().getFullYear()} Fai-Clipper</span>
            <SocialLinks iconClassName="h-4 w-4" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <ThemeSwitcher className="sm:hidden" />
            <Link href="/legal/terms" className="hover:text-ink">
              Syarat
            </Link>
            <Link href="/legal/privacy" className="hover:text-ink">
              Privasi
            </Link>
            <Link href="/" className="hover:text-ink">
              Beranda
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
