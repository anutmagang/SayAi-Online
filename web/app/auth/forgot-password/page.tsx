"use client";

import { useState } from "react";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing-shell";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    setMsg(null);
    const supabase = createClient();
    /** Prefer NEXT_PUBLIC_SITE_URL di produksi jika proxy/origin tidak sesuai domain publik. */
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") || window.location.origin;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${origin}/auth/callback?next=/auth/update-password`,
    });
    setLoading(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setMsg("Jika email terdaftar, tautan reset telah dikirim.");
  }

  return (
    <MarketingShell narrow>
      <Card className="border-edge bg-surface/95 p-8 text-ink shadow-none backdrop-blur">
        <h1 className="text-xl font-semibold text-ink">Reset password</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Masukkan email akun Anda. Kami mengirim tautan melalui Supabase Auth.
        </p>
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {err ? (
            <p className="text-sm text-red-600" role="alert">
              {err}
            </p>
          ) : null}
          {msg ? (
            <p className="text-sm text-emerald-700" role="status">
              {msg}
            </p>
          ) : null}
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? "Mengirim…" : "Kirim tautan"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="font-medium text-accent hover:underline">
            Kembali ke masuk
          </Link>
        </p>
      </Card>
    </MarketingShell>
  );
}
