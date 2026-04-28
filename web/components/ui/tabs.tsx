"use client";

import { cn } from "@/lib/cn";

type TabKey = string;

export function Tabs({
  value,
  onValueChange,
  tabs,
}: {
  value: TabKey;
  onValueChange: (v: TabKey) => void;
  tabs: { id: TabKey; label: string }[];
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-subtle p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onValueChange(t.id)}
          className={cn(
            "flex-1 rounded-md px-3 py-2 text-sm font-medium transition",
            value === t.id
              ? "bg-surface text-ink shadow-sm"
              : "text-ink-muted hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
