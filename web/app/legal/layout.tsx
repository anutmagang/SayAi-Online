import { MarketingShell } from "@/components/marketing-shell";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MarketingShell>
      <main className="prose prose-sm max-w-none py-4 text-ink-muted prose-headings:text-ink prose-p:text-ink-muted prose-a:text-accent prose-strong:text-ink">
        {children}
      </main>
    </MarketingShell>
  );
}
