from __future__ import annotations

import os
import subprocess
from pathlib import Path

from clipper.binaries import ytdlp_bin


def download_video(url: str, work_dir: Path) -> Path:
    """Download best merged video+audio with yt-dlp into work_dir."""
    work_dir.mkdir(parents=True, exist_ok=True)
    template = str(work_dir / "source.%(ext)s")
    timeout = int(os.environ.get("DOWNLOAD_TIMEOUT_SEC", "1800"))  # 30 min default
    exe = ytdlp_bin()
    cmd: list[str] = [
        exe,
        "-f", "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b",
        "--merge-output-format", "mp4",
        "-o", template,
        "--no-playlist",
        "--no-warnings",
        "--socket-timeout", "60",
        "--retries", "3",
    ]

    # YouTube sering meminta login dari IP datacenter — pakai cookies ekspor browser.
    # https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp
    cookies_file = os.environ.get("YTDLP_COOKIES", "").strip()
    if cookies_file:
        cpath = Path(cookies_file).expanduser()
        if not cpath.is_file():
            raise FileNotFoundError(
                f"YTDLP_COOKIES path not found: {cpath}. Export cookies.txt from your browser."
            )
        cmd.extend(["--cookies", str(cpath.resolve())])
    else:
        cfb = os.environ.get("YTDLP_COOKIES_FROM_BROWSER", "").strip()
        if cfb:
            cmd.extend(["--cookies-from-browser", cfb])

    cmd.append(url)
    subprocess.run(cmd, check=True, timeout=timeout)
    candidates = sorted(
        work_dir.glob("source.*"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(f"No output from yt-dlp in {work_dir}")
    return candidates[0]
