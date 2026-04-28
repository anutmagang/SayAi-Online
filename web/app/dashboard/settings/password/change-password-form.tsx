"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_FAILURES_BEFORE_LOCK = 5;

export function ChangePasswordForm({
  userEmail,
  lockoutUntil,
  failureCount,
}: {
  userEmail: string;
  lockoutUntil: string | null;
  failureCount: number;
}) {
  const router = useRouter();
  const [oldPassword, setOldPassword] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const lockoutActive = lockoutUntil != null && new Date(lockoutUntil) > new Date();
  const remainingBeforeLock = Math.max(0, MAX_FAILURES_BEFORE_LOCK - failureCount);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (lockoutActive) {
      setError("Akun sementara tidak bisa ganti password di sini. Gunakan reset lewat email.");
      return;
    }
    if (!oldPassword) {
      setError("Masukkan password lama terlebih dahulu.");
      return;
    }
    if (password.length < 8) {
      setError("Password baru minimal 8 karakter");
      return;
    }
    if (password !== password2) {
      setError("Konfirmasi password baru tidak cocok");
      return;
    }
    if (oldPassword === password) {
      setError("Password baru harus berbeda dari password lama.");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    const signIn = await supabase.auth.signInWithPassword({
      email: userEmail,
      password: oldPassword,
    });

    if (signIn.error) {
      const track = await fetch("/api/me/password-tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "failure" }),
      });
      const j = (await track.json().catch(() => ({}))) as {
        failures?: number;
        locked?: boolean;
        lockout_until?: string;
      };
      setLoading(false);
      const fails = typeof j.failures === "number" ? j.failures : failureCount + 1;
      const rem = Math.max(0, MAX_FAILURES_BEFORE_LOCK - fails);
      if (j.locked || rem <= 0) {
        setError(
          "Terlalu banyak percobaan gagal. Form ganti password dinonaktifkan sementara (24 jam). Gunakan reset password lewat email.",
        );
      } else {
        setError(
          `Password lama tidak cocok. Perkiraan sisa percobaan aman: ${rem}. Jika lupa, gunakan reset email.`,
        );
      }
      router.refresh();
      return;
    }

    const { error: upErr } = await supabase.auth.updateUser({ password });
    if (upErr) {
      setLoading(false);
      setError(upErr.message);
      return;
    }

    await fetch("/api/me/password-tracking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear" }),
    });

    setLoading(false);
    setOk("Password berhasil diubah.");
    setOldPassword("");
    setPassword("");
    setPassword2("");
    router.refresh();
  }

  if (lockoutActive) {
    return (
      <div className="mt-6 space-y-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p>
          Terlalu banyak percobaan gagal memverifikasi password lama. Form ganti password
          dinonaktifkan sementara hingga{" "}
          <strong>{new Date(lockoutUntil!).toLocaleString("id-ID")}</strong>.
        </p>
        <p>
          Gunakan <strong>reset password lewat email</strong> untuk segera mengatur ulang
          akses — setelah berhasil, Anda bisa kembali ke halaman ini.
        </p>
        <Link
          href="/auth/forgot-password"
          className="inline-block font-medium text-accent underline"
        >
          Lupa password / reset email
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
      <p className="text-xs text-ink-muted">
        Demi keamanan, password lama diverifikasi dulu. Setelah{" "}
        <strong>{MAX_FAILURES_BEFORE_LOCK}</strong> gagal berturut-turut, form ini dikunci
        24 jam — gunakan reset email. Sisa toleransi perkiraan:{" "}
        <strong>{remainingBeforeLock}</strong> percobaan.
      </p>
      <div className="flex flex-col gap-1">
        <Label htmlFor="oldpw">Password lama</Label>
        <Input
          id="oldpw"
          type="password"
          autoComplete="current-password"
          required
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="npw">Password baru</Label>
        <Input
          id="npw"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="npw2">Ulangi password baru</Label>
        <Input
          id="npw2"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
        />
      </div>
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="text-sm text-emerald-700" role="status">
          {ok}
        </p>
      ) : null}
      <Button type="submit" variant="primary" disabled={loading}>
        {loading ? "Menyimpan…" : "Simpan password"}
      </Button>
      <p className="text-xs text-ink-muted">
        Lupa password lama?{" "}
        <Link href="/auth/forgot-password" className="font-medium text-accent underline">
          Reset lewat email
        </Link>
      </p>
    </form>
  );
}
