"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthTurnstile } from "@/components/auth-turnstile";
import { CloudflareTrustRow } from "@/components/cloudflare-trust-row";
import { MarketingShell } from "@/components/marketing-shell";
import { SocialLinks } from "@/components/social-links";
import { createClient } from "@/lib/supabase/client";

const field =
  "w-full rounded-xl border border-edge bg-canvas px-3 py-2.5 text-sm text-ink placeholder:text-ink-muted/70 outline-none transition focus:border-accent/50 focus:ring-2 focus:ring-accent/25";

const needsTurnstile = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    if (needsTurnstile) {
      if (!turnstileToken?.trim()) {
        setLoading(false);
        setError("Selesaikan verifikasi Cloudflare (Turnstile) terlebih dahulu.");
        return;
      }
      const vr = await fetch("/api/turnstile/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: turnstileToken }),
      });
      const body = (await vr.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!vr.ok || !body.ok) {
        setLoading(false);
        setError(body.error ?? "Verifikasi Cloudflare gagal. Muat ulang halaman dan coba lagi.");
        return;
      }
    }
    const supabase = createClient();
    const { error: signErr } = await supabase.auth.signUp({
      email,
      password,
    });
    setLoading(false);
    if (signErr) {
      setError(signErr.message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <MarketingShell narrow>
      <div className="mx-auto w-full max-w-md rounded-2xl border border-edge bg-surface/95 p-8 shadow-xl shadow-black/10 backdrop-blur">
        <h1 className="text-2xl font-semibold text-ink">Daftar</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Buat akun untuk menyimpan riwayat job klip — 5 kredit gratis untuk mulai.
        </p>
        <form onSubmit={(e) => void onSubmit(e)} className="mt-8 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-ink">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-ink">Password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={field}
            />
          </label>
          <AuthTurnstile onToken={setTurnstileToken} />
          <CloudflareTrustRow className="mt-1" />
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-black/10 transition hover:opacity-95 disabled:opacity-50"
          >
            {loading ? "Memproses…" : "Buat akun"}
          </button>
        </form>
        <SocialLinks className="mt-8 border-t border-edge pt-6" />
        <p className="mt-6 text-center text-sm text-ink-muted">
          Sudah punya akun?{" "}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Masuk
          </Link>
        </p>
      </div>
    </MarketingShell>
  );
}
