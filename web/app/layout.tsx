import type { Metadata } from "next";
import Script from "next/script";
import { Providers } from "@/components/providers";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fai-Clipper — AI clip maker",
  description:
    "Fai-Clipper mengubah video panjang (YouTube / upload) jadi klip vertikal 9:16 siap unggah ke TikTok, Reels, atau Shorts — transkrip otomatis, pilihan momen oleh AI, karaoke captions.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className="min-h-screen">
        <Script id="theme-boot" strategy="beforeInteractive">
          {THEME_BOOT_SCRIPT}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
