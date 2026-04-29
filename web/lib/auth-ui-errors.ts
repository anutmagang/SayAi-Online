/** Pesan ramah untuk error jaringan ke Supabase Auth dari browser. */
export function friendlyAuthNetworkError(raw: string | undefined | null): string {
  if (!raw) return "Terjadi kesalahan jaringan.";
  const lower = raw.toLowerCase();
  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("network request failed")
  ) {
    return (
      "Browser tidak bisa menghubungi Supabase (Failed to fetch). " +
      "Periksa: (1) di server, `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` di `web/.env.local` benar; " +
      "(2) setelah mengubah variabel `NEXT_PUBLIC_*`, wajib `npm run build` lalu `pm2 restart`; " +
      "(3) project Supabase tidak paused; (4) tidak ada firewall/adblock yang memblokir `*.supabase.co`."
    );
  }
  return raw;
}
