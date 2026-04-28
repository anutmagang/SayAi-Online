/** Baris kepercayaan untuk halaman sensitif (login / daftar). */
export function CloudflareTrustRow({ className }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-2 text-[11px] text-ink-muted ${className ?? ""}`}
    >
      <svg className="h-4 w-4 shrink-0 text-[#F48120]" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 2L3 6v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V6l-9-4zm0 2.18l6.9 3.06v4.76c0 4.67-3.13 8.9-6.9 10.09-3.77-1.19-6.9-5.42-6.9-10.09V7.24L12 4.18z"
        />
      </svg>
      <span>
        Form login &amp; pendaftaran dilindungi dengan{" "}
        <span className="font-medium text-ink">Cloudflare Turnstile</span> bila dikonfigurasi
        di server.
      </span>
    </div>
  );
}
