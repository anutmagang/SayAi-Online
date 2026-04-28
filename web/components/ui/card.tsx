import { cn } from "@/lib/cn";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-edge bg-surface p-6 shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}
