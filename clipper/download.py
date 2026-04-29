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


def _is_youtube(url: str) -> bool:
    u = url.lower()
    return "youtube.com" in u or "youtu.be" in u


def _append_youtube_extractor_args(cmd: list[str], url: str) -> None:
    """YouTube sering mengembalikan 0 format dengan client web default — android membuka daftar format."""
    if not _is_youtube(url):
        return
    custom = os.environ.get("YTDLP_EXTRACTOR_ARGS", "").strip()
    if custom:
        cmd.extend(["--extractor-args", custom])
        return
    # Bisa override penuh lewat env; bawa android + web sebagai fallback umum.
    cmd.extend(["--extractor-args", "youtube:player_client=android,web"])


def download_video(url: str, work_dir: Path) -> Path:
    """Download best merged video+audio with yt-dlp into work_dir."""
    work_dir.mkdir(parents=True, exist_ok=True)
    template = str(work_dir / "source.%(ext)s")
    timeout = int(os.environ.get("DOWNLOAD_TIMEOUT_SEC", "1800"))  # 30 min default
    exe = ytdlp_bin()
    fmt = _ytdlp_format_string()

    cookies_for_ytdlp: Path | None = None
    cookies_file = os.environ.get("YTDLP_COOKIES", "").strip()
    if cookies_file:
        cpath = Path(cookies_file).expanduser()
        if not cpath.is_file():
            raise FileNotFoundError(
                f"YTDLP_COOKIES path not found: {cpath}. Export cookies.txt from your browser."
            )
        cookies_for_ytdlp = _prepare_cookies_file_for_ytdlp(cpath, work_dir)

    def build_cmd(with_merge_mp4: bool, format_override: str | None = None) -> list[str]:
        c: list[str] = [exe]
        _append_youtube_extractor_args(c, url)
        c.extend(
            [
                "-f",
                format_override or fmt,
                "-o",
                template,
                "--no-playlist",
                "--no-warnings",
                "--socket-timeout",
                "60",
                "--retries",
                "3",
            ]
        )
        if with_merge_mp4:
            c.extend(["--merge-output-format", "mp4"])
        if cookies_for_ytdlp is not None:
            c.extend(["--cookies", str(cookies_for_ytdlp)])
        else:
            cfb = os.environ.get("YTDLP_COOKIES_FROM_BROWSER", "").strip()
            if cfb:
                c.extend(["--cookies-from-browser", cfb])
        return c

    # Urutan percobaan: merge mp4 → tanpa merge (best progressive sering gagal jika dipaksa merge).
    attempts: list[tuple[str, list[str]]] = [
        ("merge mp4", build_cmd(True) + [url]),
        ("no merge (same -f)", build_cmd(False) + [url]),
        ("best, no merge", build_cmd(False, "best") + [url]),
    ]

    last_err = ""
    for label, full in attempts:
        r = subprocess.run(full, capture_output=True, text=True, timeout=timeout)
        if r.returncode == 0:
            break
        tail = ((r.stderr or "") + "\n" + (r.stdout or "")).strip()[-4000:]
        last_err = f"[{label}] {tail}"
        if "Requested format is not available" not in (r.stderr or "") + (r.stdout or ""):
            # error lain — jangan lanjut diam-diam
            raise RuntimeError(f"yt-dlp gagal ({label}):\n{tail}") from None
    else:
        raise RuntimeError(f"yt-dlp: semua percobaan format gagal:\n{last_err}") from None
    candidates = sorted(
        work_dir.glob("source.*"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(f"No output from yt-dlp in {work_dir}")
    return candidates[0]
