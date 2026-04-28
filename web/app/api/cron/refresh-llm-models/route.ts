import { NextResponse } from "next/server";
import { refreshLlmModelCatalog, verifyCronAuth } from "@/lib/llm-catalog-refresh";

export const runtime = "nodejs";

/** Dipanggil Vercel Cron atau scheduler eksternal (Bearer / query / x-cron-secret). */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json(
      { error: "CRON_SECRET belum di-set di environment server web." },
      { status: 503 },
    );
  }
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await refreshLlmModelCatalog();
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
