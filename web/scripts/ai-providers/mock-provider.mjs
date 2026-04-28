export async function generateWithMock(opts) {
  return {
    provider: "mock",
    kind: opts.kind,
    prompt: opts.prompt,
    aspectRatio: opts.aspectRatio,
    durationSec: opts.durationSec,
    // worker will materialize media with ffmpeg fallback path
    materialize: "ffmpeg",
  };
}
