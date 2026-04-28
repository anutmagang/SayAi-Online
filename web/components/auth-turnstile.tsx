"use client";

import { Turnstile } from "@marsidev/react-turnstile";

const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";

type AuthTurnstileProps = {
  onToken: (token: string | null) => void;
};

export function AuthTurnstile({ onToken }: AuthTurnstileProps) {
  if (!siteKey) {
    return (
      <p className="text-[11px] text-ink-muted">
        Verifikasi bot (Cloudflare) belum diaktifkan — set{" "}
        <code className="rounded bg-subtle px-1">NEXT_PUBLIC_TURNSTILE_SITE_KEY</code> dan{" "}
        <code className="rounded bg-subtle px-1">TURNSTILE_SECRET_KEY</code>.
      </p>
    );
  }

  return (
    <div className="flex min-h-[65px] items-center justify-center">
      <Turnstile
        siteKey={siteKey}
        onSuccess={(t) => onToken(t)}
        onExpire={() => onToken(null)}
        onError={() => onToken(null)}
      />
    </div>
  );
}
