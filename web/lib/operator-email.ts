import "server-only";

/** Kirim email alert operator (Resend). */
export async function sendOperatorAlertEmail(subject: string, textBody: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_ALERT_FROM?.trim();
  const toRaw = process.env.OPERATOR_ALERT_EMAIL?.trim();
  if (!apiKey || !from || !toRaw) return false;
  const to = toRaw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!to.length) return false;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text: textBody,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  return res.ok;
}
