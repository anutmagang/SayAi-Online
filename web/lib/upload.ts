import path from "path";

const ALLOWED_EXT = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".mkv",
  ".m4a",
  ".mp3",
  ".wav",
]);

export function maxUploadBytes(): number {
  const mb = Number(process.env.MAX_UPLOAD_MB ?? "2048");
  if (!Number.isFinite(mb) || mb <= 0) {
    return 2048 * 1024 * 1024;
  }
  return Math.floor(mb * 1024 * 1024);
}

/** Accept an extension or mime; return a canonical ".mp4"-style extension or null. */
export function safeVideoExtension(filename: string, mime: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  if (ALLOWED_EXT.has(ext)) return ext;
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("quicktime")) return ".mov";
  if (mime.includes("matroska")) return ".mkv";
  if (mime.includes("mpeg")) return ".mp3";
  if (mime.includes("wav")) return ".wav";
  if (mime.startsWith("video/") || mime.startsWith("audio/")) return ".mp4";
  return null;
}

export function sanitizeBasename(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return base.slice(0, 120) || "upload";
}
