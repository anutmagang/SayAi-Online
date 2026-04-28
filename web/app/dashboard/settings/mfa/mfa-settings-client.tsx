"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FactorRow = { id: string; friendly_name?: string; factor_type: string; status: string };

async function removeUnverifiedTotpFactors(
  supabase: ReturnType<typeof createClient>,
): Promise<{ error: Error | null }> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return { error: new Error(error.message) };
  const all = (data?.all ?? []) as FactorRow[];
  for (const f of all) {
    if (f.factor_type !== "totp" || f.status === "verified") continue;
    const { error: u } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (u) return { error: new Error(u.message) };
  }
  return { error: null };
}

export function MfaSettingsClient() {
  const supabase = createClient();
  const [factors, setFactors] = useState<FactorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [enrollId, setEnrollId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");

  async function refresh() {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase.auth.mfa.listFactors();
    setLoading(false);
    if (error) {
      setErr(error.message);
      return;
    }
    const all = (data?.all ?? []) as FactorRow[];
    setFactors(all.filter((f) => f.factor_type === "totp" && f.status === "verified"));
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startEnroll() {
    setErr(null);
    setMsg(null);
    setQr(null);
    setSecret(null);
    setEnrollId(null);
    setVerifyCode("");
    const cleaned = await removeUnverifiedTotpFactors(supabase);
    if (cleaned.error) {
      setErr(cleaned.error.message);
      return;
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Authenticator app",
    });
    if (error) {
      setErr(error.message);
      return;
    }
    if (!data?.id) {
      setErr("MFA: respons tidak valid");
      return;
    }
    setEnrollId(data.id);
    setQr(data.totp?.qr_code ?? null);
    setSecret(data.totp?.secret ?? null);
  }

  async function confirmEnroll() {
    if (!enrollId) return;
    setErr(null);
    setMsg(null);
    const code = verifyCode.replace(/\s/g, "");
    if (code.length < 6) {
      setErr("Masukkan kode 6 digit dari aplikasi authenticator.");
      return;
    }
    const verify = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrollId,
      code,
    });
    if (verify.error) {
      setErr(verify.error.message);
      return;
    }
    setMsg("2FA berhasil diaktifkan.");
    setEnrollId(null);
    setQr(null);
    setSecret(null);
    setVerifyCode("");
    await supabase.auth.refreshSession();
    void refresh();
  }

  async function unenrollFactor(id: string) {
    if (!confirm("Nonaktifkan 2FA untuk faktor ini?")) return;
    setErr(null);
    setMsg(null);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) {
      setErr(error.message);
      return;
    }
    setMsg("2FA dinonaktifkan.");
    await supabase.auth.refreshSession();
    void refresh();
  }

  async function cancelEnroll() {
    setErr(null);
    let firstErr: string | null = null;
    if (enrollId) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: enrollId });
      if (error) firstErr = error.message;
    }
    const cleaned = await removeUnverifiedTotpFactors(supabase);
    if (cleaned.error) firstErr = firstErr ?? cleaned.error.message;
    if (firstErr) setErr(firstErr);
    setEnrollId(null);
    setQr(null);
    setSecret(null);
    setVerifyCode("");
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">
        Autentikasi dua faktor (TOTP) memakai aplikasi seperti Google Authenticator atau
        Authy. Setelah aktif, login Anda memerlukan kode tambahan sesuai kebijakan Supabase
        Auth di project ini.
      </p>

      {loading ? <p className="text-sm text-ink-muted">Memuat…</p> : null}
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

      {factors.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {factors.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge bg-subtle px-3 py-2"
            >
              <span>
                {f.friendly_name ?? "TOTP"} <span className="text-ink-muted">({f.id.slice(0, 8)}…)</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                className="text-xs text-red-700"
                onClick={() => void unenrollFactor(f.id)}
              >
                Cabut
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        !enrollId && <p className="text-sm text-ink-muted">Belum ada faktor MFA terverifikasi.</p>
      )}

      {!enrollId ? (
        <Button type="button" variant="secondary" onClick={() => void startEnroll()}>
          Tambah authenticator (TOTP)
        </Button>
      ) : (
        <div className="space-y-4 rounded-xl border border-edge bg-surface p-4">
          <p className="text-sm font-medium text-ink">Selesaikan pendaftaran</p>
          <p className="text-xs text-ink-muted">
            Pindai QR dengan aplikasi OTP, atau salin secret manual lalu masukkan kode 6 digit.
          </p>
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR MFA" className="mx-auto max-w-[200px] rounded border border-edge bg-canvas p-2" />
          ) : null}
          {secret ? (
            <p className="break-all font-mono text-xs text-ink-muted">
              Secret: <span className="text-ink">{secret}</span>
            </p>
          ) : null}
          <div className="flex flex-col gap-1">
            <Label htmlFor="mfa-code">Kode verifikasi</Label>
            <Input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" onClick={() => void confirmEnroll()}>
              Verifikasi &amp; simpan
            </Button>
            <Button type="button" variant="ghost" onClick={() => void cancelEnroll()}>
              Batal
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
