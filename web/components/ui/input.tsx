import { cn } from "@/lib/cn";
import type { InputHTMLAttributes } from "react";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-ink outline-none ring-accent focus:ring-2",
        className,
      )}
      {...props}
    />
  );
}
