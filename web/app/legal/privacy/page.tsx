export const metadata = {
  title: "Kebijakan Privasi — Fai-Clipper",
};

export default function PrivacyPage() {
  return (
    <article className="max-w-none space-y-4">
      <h1 className="text-2xl font-semibold">Kebijakan Privasi</h1>
      <p className="text-xs uppercase tracking-wide text-slate-500">
        Versi 1.0 · 23 April 2026
      </p>

      <section>
        <h2 className="mt-6 text-lg font-semibold">Bahasa Indonesia</h2>
        <h3 className="mt-4 font-medium">Data yang kami proses</h3>
        <ul className="list-disc space-y-1 pl-6">
          <li>Identitas akun (email, status verifikasi) — dari pendaftaran.</li>
          <li>
            Metadata pembayaran (nominal, tanggal transfer, no. referensi bank).
          </li>
          <li>Konten yang Anda kirim (URL, file video, hasil klip).</li>
          <li>Telemetri teknis (log job, error message, durasi).</li>
        </ul>
        <p>
          Kami tidak menyimpan nomor kartu / rekening lengkap. Saat ini
          pembayaran manual transfer bank.
        </p>

        <h3 className="mt-4 font-medium">Retensi</h3>
        <ul className="list-disc space-y-1 pl-6">
          <li>Source video &amp; klip: 14 hari, lalu dihapus otomatis.</li>
          <li>Metadata job: 12 bulan untuk audit.</li>
          <li>Akun: selama aktif; hapus akun → cascade 14 hari.</li>
          <li>Catatan pembayaran: 5 tahun (compliance pajak).</li>
        </ul>

        <h3 className="mt-4 font-medium">Pihak ketiga</h3>
        <p>
          Supabase (DB + Storage), Groq (transcription + LLM), Google AI (LLM),
          OpenAI, Anthropic, Sentry (error telemetry tanpa konten video).
        </p>

        <h3 className="mt-4 font-medium">Hak Anda</h3>
        <p>
          Sesuai UU PDP 27/2022 Anda dapat meminta salinan, koreksi, atau
          penghapusan data. Kirim email ke{" "}
          <strong>hello@verinusa.com</strong> dari email akun Anda.
        </p>
      </section>

      <section>
        <h2 className="mt-10 text-lg font-semibold">English</h2>
        <h3 className="mt-4 font-medium">Data we process</h3>
        <ul className="list-disc space-y-1 pl-6">
          <li>Account identity (email, verification status) — from signup.</li>
          <li>Payment metadata (amount, date, bank reference).</li>
          <li>User-submitted content (URLs, uploaded videos, output clips).</li>
          <li>Technical telemetry (job logs, error messages, durations).</li>
        </ul>
        <p>
          We do not store full card / bank numbers. Payments are manual bank
          transfer for now.
        </p>

        <h3 className="mt-4 font-medium">Retention</h3>
        <ul className="list-disc space-y-1 pl-6">
          <li>Source videos &amp; clips: 14 days, then auto-deleted.</li>
          <li>Job metadata: 12 months for audit.</li>
          <li>Account: as long as active; deletion cascades within 14 days.</li>
          <li>Billing records: 5 years (Indonesian tax compliance).</li>
        </ul>

        <h3 className="mt-4 font-medium">Third parties</h3>
        <p>
          Supabase (DB + Storage), Groq (transcription + LLM), Google AI (LLM),
          OpenAI, Anthropic, Sentry (errors only, no video content).
        </p>

        <h3 className="mt-4 font-medium">Your rights</h3>
        <p>
          Per Indonesia's PDP Law 27/2022 you may request a copy, correction,
          or deletion of your data. Email <strong>hello@verinusa.com</strong>{" "}
          from the account address.
        </p>
      </section>
    </article>
  );
}
