import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Siteverify = { success?: boolean; "error-codes"?: string[] };

export async function POST(request: Request) {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  if (!secret || !siteKey) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const json = (await request.json().catch(() => null)) as { token?: string } | null;
  const token = typeof json?.token === "string" ? json.token.trim() : "";
  if (!token) {
    return NextResponse.json({ ok: false, error: "Token Turnstile wajib." }, { status: 400 });
  }

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = (await res.json().catch(() => ({}))) as Siteverify;
  if (!data.success) {
    return NextResponse.json(
      { ok: false, error: "Verifikasi Cloudflare gagal.", codes: data["error-codes"] },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
