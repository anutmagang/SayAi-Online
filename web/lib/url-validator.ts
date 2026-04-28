const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "music.youtube.com",
]);

export function isYoutubeUrl(input: string): boolean {
  try {
    const u = new URL(input.trim());
    if (!/^https?:$/.test(u.protocol)) return false;
    return YT_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}
