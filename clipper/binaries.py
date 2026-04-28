from __future__ import annotations

import shutil


def require_ffmpeg() -> None:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg not found on PATH (required for cutting).")
    if not shutil.which("ffprobe"):
        raise RuntimeError("ffprobe not found on PATH (required for duration).")


def require_yt_dlp() -> None:
    if not shutil.which("yt-dlp"):
        raise RuntimeError(
            "yt-dlp not found on PATH. After `pip install -r requirements.txt`, "
            "activate the venv so the Scripts folder is on PATH, or install yt-dlp globally."
        )
