from __future__ import annotations

import logging
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2

from clipper.phase3_ass import write_karaoke_ass, words_for_clip
from clipper.phase3_faces import compute_vertical_crop, detect_face_center_normalized

log = logging.getLogger(__name__)

_BUNDLED_FONTS_CONF = Path(__file__).resolve().parent / "fontconfig" / "fonts.conf"


def _ffmpeg_env() -> dict[str, str]:
    """Copy os.environ and point fontconfig at bundled fonts.conf when present.

    Static Windows FFmpeg builds often ship without a default fonts.conf; libass
    and drawtext then crash. Pointing FONTCONFIG_FILE at system fonts fixes it.
    """
    env = dict(os.environ)
    if _BUNDLED_FONTS_CONF.is_file():
        env["FONTCONFIG_FILE"] = str(_BUNDLED_FONTS_CONF)
    return env


def _ffmpeg_escape_filter_path(filename: str) -> str:
    """Escape a *filename* (no directory!) for an ffmpeg filter option value.

    We run ffmpeg with cwd set to the temp dir, so only the basename is needed.
    This sidesteps Windows drive-letter colon escaping issues entirely.
    """
    return filename.replace("\\", "/").replace(":", "\\:").replace("'", "\\'")


def _drawtext_fontfile_kv() -> str:
    """Prefix `fontfile=…:` untuk drawtext — Windows sering crash tanpa font eksplisit."""
    raw = os.environ.get("FFMPEG_DRAW_TEXT_FONT", "").strip()
    candidates: list[Path] = []
    if raw:
        candidates.append(Path(raw))
    if sys.platform == "win32":
        candidates.append(Path(r"C:\Windows\Fonts\arial.ttf"))
        candidates.append(Path(r"C:\Windows\Fonts\segoeui.ttf"))
    for p in candidates:
        try:
            if p.is_file():
                fp = str(p.resolve()).replace("\\", "/")
                esc = fp.replace(":", r"\:").replace("'", r"\'")
                return f"fontfile={esc}:"
        except OSError:
            continue
    return ""


def _drawtext_watermark(
    _out_w: int,
    out_h: int,
    text: str,
    position: str = "bottom_right",
) -> str:
    """ffmpeg drawtext filter for a subtle watermark (posisi bisa diatur)."""
    # Escape problematic chars for ffmpeg filter graph.
    safe = text.replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:")
    # Font-size proportional to the shorter edge (height here).
    fontsize = max(16, int(out_h * 0.025))
    margin = max(18, int(out_h * 0.015))
    pos = (position or "bottom_right").strip().lower()
    if pos == "top_left":
        x_expr, y_expr = str(margin), str(margin)
    elif pos == "top_right":
        x_expr, y_expr = f"w-tw-{margin}", str(margin)
    elif pos == "bottom_left":
        x_expr, y_expr = str(margin), f"h-th-{margin}"
    elif pos == "center":
        x_expr, y_expr = "(w-tw)/2", "(h-th)/2"
    else:
        x_expr, y_expr = f"w-tw-{margin}", f"h-th-{margin}"
    ff = _drawtext_fontfile_kv()
    head = f",drawtext={ff}text='{safe}'" if ff else f",drawtext=text='{safe}'"
    return (
        f"{head}"
        ":fontcolor=white@0.55"
        ":bordercolor=black@0.35"
        ":borderw=1"
        f":fontsize={fontsize}"
        f":x={x_expr}"
        f":y={y_expr}"
    )


def apply_vertical_and_captions(
    clip_path: Path,
    clip_start: float,
    clip_end: float,
    all_words: list[dict],
    out_w: int,
    out_h: int,
    *,
    watermark_text: str = "",
    watermark_position: str = "bottom_right",
    burn_captions: bool = False,
) -> None:
    """In-place: replace clip_path dengan 9:16 + opsional watermark + opsional karaoke ASS.

    - `burn_captions=False` (default): hanya crop/scale + watermark — **tanpa** subtitle terbakar.
    - `burn_captions=True`: tambah ASS kata-per-kata (PHASE3_BURN_CAPTIONS=1 di env).
    """
    nx, ny = detect_face_center_normalized(clip_path)
    cap = cv2.VideoCapture(str(clip_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open clip for sizing: {clip_path}")
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()

    crop_w, crop_h, crop_x, crop_y = compute_vertical_crop(w, h, nx, ny)
    rel_words = (
        words_for_clip(all_words, clip_start, clip_end) if burn_captions else []
    )

    tmp_dir = Path(tempfile.mkdtemp(prefix="clipper_p3_"))
    timeout = int(os.environ.get("FFMPEG_TIMEOUT_SEC", "1200"))
    try:
        ass_filename = "cap.ass"
        if burn_captions and rel_words:
            ass_path = tmp_dir / ass_filename
            write_karaoke_ass(
                ass_path,
                rel_words,
                out_w,
                out_h,
                clip_timeline_sec=clip_end - clip_start,
            )
            ass_opt = f",ass={_ffmpeg_escape_filter_path(ass_filename)}"
        else:
            ass_opt = ""

        wm_opt = (
            _drawtext_watermark(out_w, out_h, watermark_text, watermark_position)
            if watermark_text
            else ""
        )

        vf_plain = (
            f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y},"
            f"scale={out_w}:{out_h}:flags=lanczos"
        )
        vf_wm = f"{vf_plain}{wm_opt}" if wm_opt else vf_plain
        vf_full = f"{vf_plain}{ass_opt}{wm_opt}"

        # Rantai fallback: dulu full (ass+wm), lalu wm-only, lalu ass-only / plain
        # bila drawtext crash di Windows (tanpa fontfile / bug FFmpeg).
        vf_chain: list[str] = [vf_full]
        if ass_opt and vf_wm != vf_full:
            vf_chain.append(vf_wm)
        if wm_opt:
            if ass_opt:
                vf_ass_only = f"{vf_plain}{ass_opt}"
                if vf_ass_only not in vf_chain:
                    vf_chain.append(vf_ass_only)
            if vf_plain not in vf_chain:
                vf_chain.append(vf_plain)
        elif not wm_opt and vf_plain != vf_chain[-1]:
            vf_chain.append(vf_plain)

        out_tmp = tmp_dir / "out.mp4"
        env = _ffmpeg_env()
        last_result: subprocess.CompletedProcess[str] | None = None
        last_cmd: list[str] | None = None
        for i, vf in enumerate(vf_chain):
            last_cmd = [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(clip_path),
                "-vf", vf,
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-c:a", "copy",
                "-movflags", "+faststart",
                str(out_tmp),
            ]
            last_result = subprocess.run(
                last_cmd,
                cwd=str(tmp_dir),
                timeout=timeout,
                capture_output=True,
                text=True,
                env=env,
            )
            if last_result.returncode == 0:
                if wm_opt and vf == vf_plain and len(vf_chain) > 1:
                    log.warning(
                        "Watermark drawtext dilewati setelah fallback FFmpeg "
                        "(video vertikal + karaoke tetap; pertimbangkan FFMPEG_DRAW_TEXT_FONT)."
                    )
                if i > 0:
                    log.warning(
                        "ffmpeg succeeded on fallback attempt %s/%s",
                        i + 1,
                        len(vf_chain),
                    )
                break
            if i < len(vf_chain) - 1:
                log.warning(
                    "ffmpeg vf attempt %s failed, retrying simpler graph: %s",
                    i + 1,
                    (last_result.stderr or "")[:600],
                )
        else:
            assert last_result is not None and last_cmd is not None
            raise subprocess.CalledProcessError(
                last_result.returncode,
                last_cmd,
                last_result.stdout,
                last_result.stderr,
            )
        if clip_path.exists():
            clip_path.unlink()
        os.replace(out_tmp, clip_path)
    finally:
        for child in tmp_dir.glob("*"):
            try:
                child.unlink()
            except OSError:
                pass
        try:
            tmp_dir.rmdir()
        except OSError:
            pass


def apply_longform_horizontal(
    clip_path: Path,
    *,
    out_w: int = 1920,
    out_h: int = 1080,
    watermark_text: str = "",
    watermark_position: str = "bottom_right",
) -> None:
    """Pad/scale ke 16:9 (default 1080p) + watermark opsional; ganti file clip_path."""
    tmp_dir = Path(tempfile.mkdtemp(prefix="clipper_p3h_"))
    timeout = int(os.environ.get("FFMPEG_TIMEOUT_SEC", "1200"))
    try:
        wm_opt = (
            _drawtext_watermark(out_w, out_h, watermark_text, watermark_position)
            if watermark_text
            else ""
        )
        base = (
            f"scale={out_w}:{out_h}:force_original_aspect_ratio=decrease,"
            f"pad={out_w}:{out_h}:(ow-iw)/2:(oh-ih)/2"
        )
        vf_wm = base + wm_opt if wm_opt else base
        vf_chain = [vf_wm]
        if wm_opt:
            vf_chain.append(base)

        out_tmp = tmp_dir / "out.mp4"
        env = _ffmpeg_env()
        last_result: subprocess.CompletedProcess[str] | None = None
        last_cmd: list[str] | None = None
        for i, vf in enumerate(vf_chain):
            last_cmd = [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(clip_path),
                "-vf", vf,
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-c:a", "copy",
                "-movflags", "+faststart",
                str(out_tmp),
            ]
            last_result = subprocess.run(
                last_cmd,
                cwd=str(tmp_dir),
                timeout=timeout,
                capture_output=True,
                text=True,
                env=env,
            )
            if last_result.returncode == 0:
                if wm_opt and vf == base and len(vf_chain) > 1:
                    log.warning(
                        "Watermark drawtext dilewati (16:9); pertimbangkan FFMPEG_DRAW_TEXT_FONT."
                    )
                if i > 0:
                    log.warning(
                        "ffmpeg 16:9 succeeded on fallback attempt %s/%s",
                        i + 1,
                        len(vf_chain),
                    )
                break
            if i < len(vf_chain) - 1:
                log.warning(
                    "ffmpeg 16:9 vf attempt %s failed, retrying: %s",
                    i + 1,
                    (last_result.stderr or "")[:600],
                )
        else:
            assert last_result is not None and last_cmd is not None
            raise subprocess.CalledProcessError(
                last_result.returncode,
                last_cmd,
                last_result.stdout,
                last_result.stderr,
            )
        if clip_path.exists():
            clip_path.unlink()
        os.replace(out_tmp, clip_path)
    finally:
        for child in tmp_dir.glob("*"):
            try:
                child.unlink()
            except OSError:
                pass
        try:
            tmp_dir.rmdir()
        except OSError:
            pass
