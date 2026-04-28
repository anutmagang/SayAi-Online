from __future__ import annotations

import os
import subprocess
from pathlib import Path


def download_video(url: str, work_dir: Path) -> Path:
    """Download best merged video+audio with yt-dlp into work_dir."""
    work_dir.mkdir(parents=True, exist_ok=True)
    template = str(work_dir / "source.%(ext)s")
    timeout = int(os.environ.get("DOWNLOAD_TIMEOUT_SEC", "1800"))  # 30 min default
    cmd = [
        "yt-dlp",
        "-f", "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b",
        "--merge-output-format", "mp4",
        "-o", template,
        "--no-playlist",
        "--no-warnings",
        "--socket-timeout", "60",
        "--retries", "3",
        url,
    ]
    subprocess.run(cmd, check=True, timeout=timeout)
    candidates = sorted(
        work_dir.glob("source.*"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(f"No output from yt-dlp in {work_dir}")
    return candidates[0]
