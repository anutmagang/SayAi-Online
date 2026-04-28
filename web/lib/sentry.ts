/**
 * Thin Sentry wrapper. Importing this module is cheap; it only actually
 * contacts Sentry when the relevant DSN env var is set.
 *
 * Usage in an API route:
 *   import { captureException } from "@/lib/sentry";
 *   try { ... } catch (e) { captureException(e); throw e; }
 */
type Captured = Error | unknown;

let inited = false;

async function ensureInit() {
  if (inited) return;
  const dsn =
    typeof window === "undefined"
      ? process.env.SENTRY_DSN
      : process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    inited = true;
    return;
  }
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENV ?? process.env.NODE_ENV,
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
    });
  } catch {
    // Package not installed yet, degrade silently.
  }
  inited = true;
}

export async function captureException(e: Captured, context?: Record<string, unknown>) {
  await ensureInit();
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(e, context ? { extra: context } : undefined);
  } catch {
    // No-op when Sentry is absent.
    console.error("[fai-clipper]", e);
  }
}
