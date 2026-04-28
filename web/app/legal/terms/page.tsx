export const metadata = {
  title: "Syarat & Ketentuan — Fai-Clipper",
};

export default function TermsPage() {
  return (
    <article className="max-w-none space-y-4">
      <h1 className="text-2xl font-semibold">Syarat &amp; Ketentuan</h1>
      <p className="text-xs uppercase tracking-wide text-slate-500">
        Versi 1.0 · 23 April 2026
      </p>

      <section>
        <h2 className="mt-6 text-lg font-semibold">Bahasa Indonesia</h2>
        <h3 className="mt-4 font-medium">1. Akseptasi</h3>
        <p>
          Dengan mendaftar di Fai-Clipper Anda setuju terikat dengan syarat ini.
          Jika tidak setuju, jangan menggunakan layanan.
        </p>
        <h3 className="mt-4 font-medium">2. Layanan</h3>
        <p>
          Fai-Clipper mengolah sumber video milik Anda menjadi klip pendek 9:16
          via pipeline transkripsi AI + pemilihan momen + render. Hasil MP4
          dapat Anda unduh dan gunakan, tunduk pada batas tier.
        </p>
        <h3 className="mt-4 font-medium">3. Tanggung jawab konten</h3>
        <p>
          Anda bertanggung jawab penuh atas legalitas sumber video yang
          dikirim. Anda menyatakan memiliki hak / izin atas konten tersebut
          dan konten tidak melanggar hukum Indonesia. Kami berhak menolak job
          yang mengandung materi eksplisit, terorisme, SARA, pelanggaran hak
          cipta jelas, atau spam.
        </p>
        <h3 className="mt-4 font-medium">4. Kredit &amp; refund</h3>
        <ul className="list-disc space-y-1 pl-6">
          <li>Free: 5 kredit onboarding, 1 job = 1 kredit.</li>
          <li>
            Starter / Creator / Pro: kuota bulanan; sisa tidak diakumulasi ke bulan
            berikut.
          </li>
          <li>
            Setelah admin menyetujui langganan berbayar, Anda mendapat bonus kredit
            sekali ke saldo: Starter +12, Creator +30, Pro +52 (nilai mengikuti halaman
            Harga).
          </li>
          <li>Job gagal karena error sistem → refund otomatis.</li>
          <li>
            Job gagal karena input user (URL invalid, durasi lewat batas) →
            tidak di-refund.
          </li>
          <li>
            Pembayaran manual via transfer bank. Admin verifikasi ≤ 24 jam.
          </li>
        </ul>
        <h3 className="mt-4 font-medium">5. Batas tanggung jawab</h3>
        <p>
          Layanan diberikan AS IS. Kami tidak menjamin akurasi pemilihan momen,
          uptime absolut, atau kesesuaian hasil dengan kebijakan platform
          tujuan. Maksimum tanggung jawab kami = total biaya yang Anda bayarkan
          12 bulan terakhir.
        </p>
        <h3 className="mt-4 font-medium">6. Hukum</h3>
        <p>
          Tunduk hukum Republik Indonesia. Sengketa diselesaikan di Pengadilan
          Negeri Jakarta Pusat.
        </p>
      </section>

      <section>
        <h2 className="mt-10 text-lg font-semibold">English</h2>
        <h3 className="mt-4 font-medium">1. Acceptance</h3>
        <p>
          By signing up at Fai-Clipper you agree to these terms. If you do not
          agree, do not use the service.
        </p>
        <h3 className="mt-4 font-medium">2. Service</h3>
        <p>
          Fai-Clipper processes your video sources into 9:16 short clips via an
          AI transcription + moment-selection + render pipeline. Output MP4s
          are yours to download and use, subject to tier limits.
        </p>
        <h3 className="mt-4 font-medium">3. Content responsibility</h3>
        <p>
          You are solely responsible for the legality of submitted sources. You
          represent that you hold rights / a valid licence to the content and
          that it complies with applicable law. We may refuse jobs that appear
          to contain explicit material, terrorism, hate speech, clear copyright
          infringement, or bulk abuse.
        </p>
        <h3 className="mt-4 font-medium">4. Credits &amp; refunds</h3>
        <ul className="list-disc space-y-1 pl-6">
          <li>Free: 5 onboarding credits, 1 job = 1 credit.</li>
          <li>Starter / Creator / Pro: monthly quota; unused portions do not roll over.</li>
          <li>
            After an admin approves a paid subscription, a one-time credit bonus is
            added to your balance: Starter +12, Creator +30, Pro +52 (see Pricing).
          </li>
          <li>Jobs failing due to our system error: auto-refunded.</li>
          <li>
            Jobs failing due to user input (bad URL, duration cap): not refunded.
          </li>
          <li>Payments are manual bank transfer, verified within 24h.</li>
        </ul>
        <h3 className="mt-4 font-medium">5. Liability</h3>
        <p>
          Service is AS IS. We do not guarantee moment-selection accuracy,
          uptime, or destination-platform policy compatibility. Our aggregate
          liability in any 12-month period does not exceed fees paid in that
          period.
        </p>
        <h3 className="mt-4 font-medium">6. Governing law</h3>
        <p>
          Laws of the Republic of Indonesia. Disputes go to the Central Jakarta
          District Court.
        </p>
      </section>
    </article>
  );
}
