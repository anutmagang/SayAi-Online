import { AnalyticsClient } from "./analytics-client";

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Analitik</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Ringkasan job, status, dan skor viral heuristik per klip (Phase 4).
        </p>
      </div>
      <AnalyticsClient />
    </div>
  );
}
