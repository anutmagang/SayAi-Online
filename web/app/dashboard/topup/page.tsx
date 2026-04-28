import { TopupForm } from "./topup-form";

export default function TopupPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Top-up manual</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Saldo kredit dipakai per job pada paket Free, atau sebagai cadangan jika kuota
          bulanan paket berbayar sudah penuh (1 kredit = 1 job). Ajukan top-up tersedia untuk
          semua tier.
        </p>
      </div>
      <TopupForm />
    </div>
  );
}
