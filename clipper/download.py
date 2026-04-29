from __future__ import annotations

import os
import subprocess
from pathlib import Path

from clipper.binaries import ytdlp_bin

_COOKIES_WIKI = (
    "https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies"
)


def _prepare_cookies_file_for_ytdlp(src: Path, work_dir: Path) -> Path:
    """
    yt-dlp hanya menerima Netscape cookies.txt. Banyak ekstensi salah export (JSON).
    UTF-8 BOM di awal file juga bisa membuat parser gagal — strip ke salinan di work_dir.
    """
    raw = src.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        dst = work_dir / ".youtube-cookies-nobom.txt"
        dst.write_bytes(raw[3:])
        src = dst
    text = src.read_text(encoding="utf-8", errors="replace")
    stripped = text.lstrip()
    if stripped.startswith("{") or stripped.startswith("["):
        raise RuntimeError(
            "File cookie adalah JSON — yt-dlp butuh format Netscape (cookies.txt). "
            f"Di Chrome/Edge pakai ekstensi yang mengekspor 'Netscape' / 'cookies.txt' "
            f"dari tab youtube.com (sudah login). Panduan: {_COOKIES_WIKI}"
        )
    head = "\n".join(text.splitlines()[:12]).lower()
    data_lines = [
        ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")
    ]
    if not data_lines:
        raise RuntimeError(
            f"Berkas cookie kosong atau hanya komentar. Ekspor ulang dari youtube.com. {_COOKIES_WIKI}"
        )
    has_header = ("netscape" in head and "cookie" in head) or ("http cookie file" in head)
    # Baris data Netscape: banyak field dipisah tab (biasanya ≥7 tab).
    tab_rich = any(ln.count("\t") >= 6 for ln in data_lines[:100])
    if not has_header and not tab_rich:
        raise RuntimeError(
            "Berkas cookie tidak terlihat seperti Netscape cookies.txt "
            "(header # Netscape HTTP Cookie File + baris ber-tab). "
            "Jangan pakai export 'JSON' / 'EditThisCookie JSON'. "
            f"Panduan resmi yt-dlp: {_COOKIES_WIKI}"
        )
    return src.resolve()


def _ytdlp_format_string() -> str:
    """
    Rantai format dengan banyak fallback — beberapa video tidak punya pasangan bv+ba
    yang cocok dengan filter lama (error: Requested format is not available).
    """
    custom = os.environ.get("YTDLP_FORMAT", "").strip()
    if custom:
        return custom
    return (
        "bv*[height<=1080]+ba/"
        "bv[height<=1080]+ba/"
        "bv*+ba/"
        "bv+ba/"
        "bestvideo[height<=1080]+bestaudio/"
        "bestvideo+bestaudio/"
        "best"
    )


def download_video(url: str, work_dir: Path) -> Path:
    """Download best merged video+audio with yt-dlp into work_dir."""
    work_dir.mkdir(parents=True, exist_ok=True)
    template = str(work_dir / "source.%(ext)s")
    timeout = int(os.environ.get("DOWNLOAD_TIMEOUT_SEC", "1800"))  # 30 min default
    exe = ytdlp_bin()
    cmd: list[str] = [
        exe,
        "-f",
        _ytdlp_format_string(),
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
        cookies_for_ytdlp = _prepare_cookies_file_for_ytdlp(cpath, work_dir)
        cmd.extend(["--cookies", str(cookies_for_ytdlp)])
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
