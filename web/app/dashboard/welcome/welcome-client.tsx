"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function WelcomeClient() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function complete() {
    setErr(null);
    setPending(true);
    try {
      const res = await fetch("/api/onboarding/complete", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "Gagal menyimpan");
      }
      router.replace("/dashboard");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Terjadi kesalahan");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {err ? (
        <p className="text-sm text-red-600" role="alert">
          {err}
        </p>
      ) : null}
      <Button type="button" variant="primary" disabled={pending} onClick={() => void complete()}>
        {pending ? "Menyimpan…" : "Selesai — ke dashboard"}
      </Button>
    </div>
  );
}
