from __future__ import annotations

import os
import subprocess
from pathlib import Path

from clipper.analyze import ClipSuggestion


def render_clip(
    source: Path,
    clip: ClipSuggestion,
    index: int,
    out_dir: Path,
) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"clip_{index:02d}.mp4"
    duration = clip.end_sec - clip.start_sec
    timeout = int(os.environ.get("FFMPEG_TIMEOUT_SEC", "1200"))
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-ss", f"{clip.start_sec:.3f}",
        "-i", str(source),
        "-t", f"{duration:.3f}",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-movflags", "+faststart",
        str(out_path),
    ]
    subprocess.run(cmd, check=True, timeout=timeout)
    return out_path
