"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MarketingShell } from "@/components/marketing-shell";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password minimal 8 karakter");
      return;
    }
    if (password !== password2) {
      setError("Konfirmasi password tidak cocok");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error: upErr } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    await fetch("/api/me/password-tracking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear" }),
    });
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <MarketingShell narrow>
      <Card className="border-edge bg-surface/95 p-8 text-ink shadow-none backdrop-blur">
        <h1 className="text-xl font-semibold text-ink">Password baru</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Setel password baru setelah membuka tautan dari email.
        </p>
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="pw">Password baru</Label>
            <Input
              id="pw"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pw2">Ulangi password</Label>
            <Input
              id="pw2"
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
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? "Menyimpan…" : "Simpan password"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="font-medium text-accent hover:underline">
            Ke halaman masuk
          </Link>
        </p>
      </Card>
    </MarketingShell>
  );
}
