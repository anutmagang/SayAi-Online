import Link from "next/link";

export default function JobNotFound() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink">Job tidak ditemukan</h1>
      <p className="text-sm text-ink-muted">
        Job mungkin dihapus atau Anda tidak memiliki akses.
      </p>
      <Link href="/dashboard" className="text-sm font-medium text-accent hover:underline">
        ← Kembali ke dashboard
      </Link>
    </div>
  );
}
