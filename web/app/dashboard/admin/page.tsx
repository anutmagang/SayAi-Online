import { AdminLlmApiKeysClient } from "./admin-llm-api-keys-client";
import { AdminPlatformMetricsClient } from "./admin-platform-metrics-client";
import { AdminTopupsClient } from "./admin-topups-client";
import { AdminSubscriptionsClient } from "./admin-subscriptions-client";
import { AdminAIProvidersClient } from "./admin-ai-providers-client";

export default function AdminPage() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Admin</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Hanya akun dengan <span className="font-mono text-xs">is_admin</span> di tabel{" "}
          <span className="font-mono text-xs">profiles</span> yang dapat menyetujui permintaan.
        </p>
      </div>
      <section>
        <h2 className="text-lg font-semibold text-ink">Permintaan upgrade paket</h2>
        <AdminSubscriptionsClient />
      </section>
      <section>
        <h2 className="text-lg font-semibold text-ink">Permintaan top-up kredit</h2>
        <AdminTopupsClient />
      </section>
      <section>
        <h2 className="text-lg font-semibold text-ink">Ringkasan platform (agregat)</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Angka global tanpa identitas per pengguna atau judul video. Storage dari agregat bucket
          Supabase + opsi estimasi disk worker.
        </p>
        <div className="mt-3">
          <AdminPlatformMetricsClient />
        </div>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-ink">Stok API key LLM (rotasi otomatis)</h2>
        <div className="mt-2">
          <AdminLlmApiKeysClient />
        </div>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-ink">AI provider control (Phase 3)</h2>
        <div className="mt-2">
          <AdminAIProvidersClient />
        </div>
      </section>
    </div>
  );
}
