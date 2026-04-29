from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from pathlib import Path

from clipper.binaries import ytdlp_bin
from clipper.config import Settings

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


def _normalize_err_text(s: str) -> str:
    """Samakan tipografi pesan error (apostrof Unicode) supaya deteksi bot tidak gagal."""
    t = s.lower()
    for u in ("\u2019", "\u2018", "\u02bc"):
        t = t.replace(u, "'")
    return t


def _is_youtube_bot_block(blob: str) -> bool:
    """Blokir login/bot: mencoba format lain untuk player_client yang sama biasanya tidak membantu."""
    b = _normalize_err_text(blob)
    return (
        "sign in to confirm" in b
        or "please sign in" in b
        or "confirm you're not a bot" in b
        or "you're not a bot" in b
        or "not a bot" in b
    )


def _should_retry_ytdlp_attempt(blob: str) -> bool:
    """True = coba kombinasi berikutnya; False = hentikan dan angkat error ke user."""
    b = _normalize_err_text(blob)
    if "requested format is not available" in b:
        return True
    if "no video formats" in b or "no formats found" in b:
        return True
    # Jangan berhenti di percobaan pertama: client lain (android/ios/…) sering lolos
    # dengan cookie yang sama; "web" saja yang ditolak YouTube sebagai bot sangat umum.
    if "please sign in" in b or "sign in to confirm" in b:
        return True
    if "private video" in b or "members only" in b:
        return False
    if "invalid" in b and "player_client" in b:
        return True
    if "unsupported player client" in b:
        return True
    return False


def _youtube_extractor_attempts(url: str) -> list[str | None]:
    """
    Beberapa rilis yt-dlp/YouTube mengabaikan atau salah parse `player_client=a,b`.
    Coba satu client per percobaan; None = tanpa --extractor-args (jalur web bawaan).
    """
    if not _is_youtube(url):
        custom = os.environ.get("YTDLP_EXTRACTOR_ARGS", "").strip()
        return [custom or None]
    custom = os.environ.get("YTDLP_EXTRACTOR_ARGS", "").strip()
    if custom:
        return [custom]
    # Dengan cookies.txt (Netscape), client web biasanya paling selaras dengan sesi browser.
    has_cookies = bool(os.environ.get("YTDLP_COOKIES", "").strip())
    chain = [
        "youtube:player_client=android",
        "youtube:player_client=ios",
        "youtube:player_client=mweb",
        "youtube:player_client=tv_embedded",
        "youtube:player_client=web_creator",
        None,
    ]
    if has_cookies:
        return [
            "youtube:player_client=web",
            "youtube:player_client=web_embedded",
            *chain,
        ]
    return chain


def _can_emit_job_events(settings: Settings | None) -> bool:
    if settings is None:
        return False
    return bool(settings.job_events_url and settings.job_id and settings.user_id)


def _emit_download(
    settings: Settings | None,
    *,
    message: str,
    progress: float,
) -> None:
    if not _can_emit_job_events(settings):
        return
    from clipper.events import emit

    emit(settings, phase="downloading", message=message[:500], progress=progress)


def _run_ytdlp_with_heartbeat(
    full: list[str],
    timeout_sec: int,
    settings: Settings | None,
    url: str,
    label: str,
    idx: int,
    total: int,
) -> subprocess.CompletedProcess[str]:
    """Heartbeat ke job_events supaya UI tidak tertahan di 5% tanpa penjelasan."""
    stop = threading.Event()
    start = time.monotonic()
    base = "YouTube" if _is_youtube(url) else "URL"

    def heartbeat() -> None:
        while True:
            if stop.wait(20):
                return
            elapsed = int(time.monotonic() - start)
            msg = (
                f"{base}: yt-dlp masih berjalan · {label[:90]} "
                f"(langkah {idx}/{total}, ~{elapsed}s — unduh/merge bisa beberapa menit)"
            )
            prog = min(
                14.0,
                5.0 + (idx - 1) / max(total, 1) * 4.0 + min(5.0, elapsed / 90.0),
            )
            _emit_download(settings, message=msg, progress=prog)

    th: threading.Thread | None = None
    if _can_emit_job_events(settings):
        th = threading.Thread(target=heartbeat, name="ytdlp-heartbeat", daemon=True)
        th.start()
    try:
        return subprocess.run(
            full,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
        )
    finally:
        stop.set()
        if th is not None and th.is_alive():
            th.join(timeout=2.0)


def download_video(url: str, work_dir: Path, settings: Settings | None = None) -> Path:
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

    if cookies_for_ytdlp is not None and _is_youtube(url):
        sz = cookies_for_ytdlp.stat().st_size
        sys.stderr.write(
            f"[clipper] yt-dlp akan memakai --cookies {cookies_for_ytdlp} ({sz} bytes)\n"
        )

    def build_cmd(
        extractor_args: str | None,
        with_merge_mp4: bool,
        format_override: str | None = None,
    ) -> list[str]:
        c: list[str] = [exe]
        if extractor_args:
            c.extend(["--extractor-args", extractor_args])
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

    def format_attempts(extractor_args: str | None) -> list[tuple[str, list[str]]]:
        ex = extractor_args or "default"
        return [
            (f"{ex} | merge mp4", build_cmd(extractor_args, True) + [url]),
            (f"{ex} | no merge", build_cmd(extractor_args, False) + [url]),
            (f"{ex} | best no merge", build_cmd(extractor_args, False, "best") + [url]),
        ]

    extractors = _youtube_extractor_attempts(url)
    total_max = sum(len(format_attempts(ex)) for ex in extractors)

    if _can_emit_job_events(settings) and total_max:
        yt_hint = (
            f"YouTube: mulai yt-dlp — hingga {total_max} percobaan; "
            "varian format dilewati otomatis bila blokir bot (lanjut ke client lain)."
            if _is_youtube(url)
            else f"Mengunduh sumber URL — hingga {total_max} percobaan."
        )
        _emit_download(settings, message=yt_hint, progress=5.0)

    last_err = ""
    log_lines: list[str] = []
    ok = False
    idx = 0
    for extractor in extractors:
        for label, full in format_attempts(extractor):
            idx += 1
            if _can_emit_job_events(settings):
                base = "YouTube" if _is_youtube(url) else "URL"
                prog = 5.0 + min(8.0, (idx - 1) / max(total_max, 1) * 8.0)
                _emit_download(
                    settings,
                    message=f"{base}: mencoba · {label[:120]} ({idx}/{total_max})",
                    progress=prog,
                )
            r = _run_ytdlp_with_heartbeat(
                full, timeout, settings, url, label, idx, total_max
            )
            if r.returncode == 0:
                ok = True
                break
            blob = (r.stderr or "") + "\n" + (r.stdout or "")
            tail = blob.strip()[-3500:]
            last_err = f"[{label}] {tail}"
            log_lines.append(last_err)
            if _should_retry_ytdlp_attempt(blob):
                if _is_youtube(url) and _is_youtube_bot_block(blob):
                    break
                continue
            raise RuntimeError(f"yt-dlp gagal ({label}):\n{tail}") from None
        if ok:
            break
    if not ok:
        had_cookies = cookies_for_ytdlp is not None
        yt = _is_youtube(url)
        all_bot = bool(log_lines) and all(_is_youtube_bot_block(line) for line in log_lines)
        if yt and not had_cookies:
            hint = (
                "YouTube meminta login/bot-check dan **tidak ada file cookie** untuk yt-dlp "
                "(variabel YTDLP_COOKIES kosong). Unggah `cookies.txt` di **Pengaturan → Cookie YouTube**, "
                "atau letakkan `secrets/youtube-cookies.txt` di server / set env YTDLP_COOKIES. "
                f"Panduan: {_COOKIES_WIKI}"
            )
        elif yt and had_cookies and all_bot:
            hint = (
                "YouTube menolak **semua** percobaan dengan pesan bot/login — **cookie sudah dikirim** "
                "(cek baris `[clipper] yt-dlp akan memakai --cookies …` di log di atas). "
                "Biasanya: (1) ekspor ulang cookie dari tab **youtube.com** saat video ini bisa diputar; "
                "(2) pakai ekstensi **Get cookies.txt LOCALLY** (bukan export JSON); "
                "(3) `sudo yt-dlp -U` di VPS; (4) IP datacenter kadang tetap ditolak — unduh video di PC lalu **Upload file**. "
                f"Detail: {_COOKIES_WIKI}"
            )
        else:
            hint = (
                "YouTube tidak mengembalikan format yang bisa diunduh (sering: yt-dlp lawas, cookie basi, "
                "atau video diblokir/region). Coba: (1) `sudo yt-dlp -U` atau `pip install -U yt-dlp`, "
                "(2) ekspor ulang cookies.txt dari akun yang bisa putar video itu di browser, "
                "(3) unduh video di PC lalu pakai Upload file. "
                f"Panduan cookie: {_COOKIES_WIKI}"
            )
        tail_log = "\n---\n".join(log_lines[-8:])
        raise RuntimeError(
            f"yt-dlp: semua kombinasi client/format gagal.\n{tail_log}\n\n{hint}"
        ) from None
    candidates = sorted(
        work_dir.glob("source.*"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(f"No output from yt-dlp in {work_dir}")
    return candidates[0]
