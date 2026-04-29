from __future__ import annotations

import os
import shutil
from pathlib import Path


def ytdlp_bin() -> str:
    """Path ke yt-dlp: env YTDLP_PATH / YT_DLP_PATH, atau binary di PATH."""
    for key in ("YTDLP_PATH", "YT_DLP_PATH"):
        raw = os.environ.get(key, "").strip()
        if not raw:
            continue
        p = Path(raw).expanduser()
        if p.is_file():
            return str(p.resolve())
    found = shutil.which("yt-dlp")
    if found:
        return found
    raise RuntimeError(
        "yt-dlp not found. Set YTDLP_PATH to the binary, install globally, "
        "or ensure venv Scripts/ is on PATH."
    )


def require_ffmpeg() -> None:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg not found on PATH (required for cutting).")
    if not shutil.which("ffprobe"):
        raise RuntimeError("ffprobe not found on PATH (required for duration).")


def require_yt_dlp() -> None:
    ytdlp_bin()
