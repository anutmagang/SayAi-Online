"use client";

import { cn } from "@/lib/cn";
import { useAppTheme, type AppTheme } from "@/components/theme-provider";

const OPTIONS: { id: AppTheme; label: string; short: string }[] = [
  { id: "light", label: "Modern putih", short: "M" },
  { id: "dark", label: "Gelap navy", short: "G" },
  { id: "glass", label: "Kaca / minimal", short: "K" },
];

type ThemeSwitcherProps = {
  compact?: boolean;
  className?: string;
};

export function ThemeSwitcher({ compact, className }: ThemeSwitcherProps) {
  const { theme, setTheme, mounted } = useAppTheme();

  return (
    <div
      className={cn(
        "inline-flex rounded-lg border border-edge bg-subtle p-0.5 text-[11px] font-medium text-ink shadow-sm",
        className,
      )}
      title="Tampilan"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => setTheme(o.id)}
          className={cn(
            "rounded-md px-2 py-1 transition",
            mounted && theme === o.id
              ? "bg-surface text-ink shadow-sm ring-1 ring-edge"
              : "text-ink-muted hover:text-ink",
          )}
        >
          {compact ? o.short : o.label}
        </button>
      ))}
    </div>
  );
}
