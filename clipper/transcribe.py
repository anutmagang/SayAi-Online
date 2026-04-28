"""Transcription with word-level timestamps.

Primary path is Groq Whisper Large v3 Turbo via HTTP — free, ~30× faster
than CPU faster-whisper for typical 10-minute videos. Falls back to local
faster-whisper if GROQ_API_KEY is missing or the API fails.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from clipper.llm.api_key_pool import is_rate_limit_error, resolve_key_entries
from clipper.llm.pool_runtime import report_key_rate_limited, report_key_success

log = logging.getLogger(__name__)

TranscribeResult = tuple[list[dict[str, Any]], list[dict[str, Any]], Path, Path, str]


def transcribe_audio(
    media_path: Path,
    model_size: str,
    work_dir: Path,
    *,
    prefer_groq: bool = True,
    groq_model: str = "whisper-large-v3-turbo",
) -> TranscribeResult:
    """Return (segments, words, segments_path, words_path, provider_used)."""
    groq_entries = resolve_key_entries("groq", "GROQ_API_KEY") if prefer_groq else []

    if prefer_groq and groq_entries:
        for i, (pool_id, groq_key) in enumerate(groq_entries):
            try:
                return _transcribe_groq(
                    media_path, work_dir, groq_key, groq_model, pool_id=pool_id
                )
            except Exception as e:  # noqa: BLE001
                if is_rate_limit_error(e):
                    if pool_id:
                        report_key_rate_limited(pool_id, "groq", str(e))
                    if i < len(groq_entries) - 1:
                        log.warning(
                            "groq whisper rate limited, trying next API key (%s/%s)",
                            i + 1,
                            len(groq_entries),
                        )
                        continue
                log.warning("groq whisper failed, falling back to CPU: %s", e)
                break

    return _transcribe_local(media_path, model_size, work_dir)


def _write_outputs(
    work_dir: Path,
    segments: list[dict[str, Any]],
    words: list[dict[str, Any]],
) -> tuple[Path, Path]:
    seg_out = work_dir / "transcript_segments.json"
    seg_out.write_text(
        json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    words_out = work_dir / "transcript_words.json"
    words_out.write_text(
        json.dumps(words, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return seg_out, words_out


def _extract_audio_m4a(media_path: Path) -> Path:
    """Groq accepts audio up to 25 MB; extract a compact m4a (AAC 64k mono 16kHz)."""
    tmp_dir = Path(tempfile.mkdtemp(prefix="clipper_groq_audio_"))
    audio_path = tmp_dir / "audio.m4a"
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(media_path),
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-c:a", "aac",
        "-b:a", "64k",
        str(audio_path),
    ]
    subprocess.run(cmd, check=True, timeout=600)
    return audio_path


def _transcribe_groq(
    media_path: Path,
    work_dir: Path,
    api_key: str,
    model: str,
    *,
    pool_id: str | None = None,
) -> TranscribeResult:
    try:
        from groq import Groq  # type: ignore
    except ImportError as e:
        raise RuntimeError(f"groq sdk missing: {e}") from e

    audio_path = _extract_audio_m4a(media_path)
    try:
        # 24 MB hard limit to leave headroom under Groq's 25 MB cap.
        size = audio_path.stat().st_size
        if size > 24 * 1024 * 1024:
            raise RuntimeError(
                f"extracted audio {size / 1024 / 1024:.1f}MB exceeds Groq cap; "
                "source longer than ~4h at 64kbps mono — use CPU whisper instead"
            )

        client = Groq(api_key=api_key)
        with open(audio_path, "rb") as fh:
            resp = client.audio.transcriptions.create(
                file=(audio_path.name, fh.read()),
                model=model,
                response_format="verbose_json",
                timestamp_granularities=["word", "segment"],
                temperature=0.0,
            )
    finally:
        try:
            audio_path.unlink()
            audio_path.parent.rmdir()
        except OSError:
            pass

    data = resp if isinstance(resp, dict) else getattr(resp, "model_dump", lambda: {})()
    if not data:
        data = json.loads(getattr(resp, "json", lambda: "{}")())

    segments: list[dict[str, Any]] = []
    for s in data.get("segments", []) or []:
        segments.append(
            {
                "start": round(float(s.get("start", 0.0)), 3),
                "end": round(float(s.get("end", 0.0)), 3),
                "text": (s.get("text") or "").strip(),
            }
        )

    words: list[dict[str, Any]] = []
    for w in data.get("words", []) or []:
        token = (w.get("word") or "").strip()
        if not token:
            continue
        try:
            words.append(
                {
                    "start": round(float(w["start"]), 3),
                    "end": round(float(w["end"]), 3),
                    "word": token,
                }
            )
        except (KeyError, ValueError, TypeError):
            continue

    if not segments and data.get("text"):
        # Groq occasionally returns only flat text when granularities disabled.
        segments = [
            {
                "start": 0.0,
                "end": float(data.get("duration", 0.0) or 0.0),
                "text": (data.get("text") or "").strip(),
            }
        ]

    seg_out, words_out = _write_outputs(work_dir, segments, words)
    if pool_id:
        report_key_success(pool_id, "groq")
    return segments, words, seg_out, words_out, f"groq:{model}"


def _transcribe_local(
    media_path: Path,
    model_size: str,
    work_dir: Path,
) -> TranscribeResult:
    from faster_whisper import WhisperModel  # type: ignore

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments_iter, _info = model.transcribe(
        str(media_path),
        beam_size=5,
        vad_filter=True,
        word_timestamps=True,
    )

    segments: list[dict[str, Any]] = []
    words: list[dict[str, Any]] = []

    for seg in segments_iter:
        segments.append(
            {
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": seg.text.strip(),
            }
        )
        if getattr(seg, "words", None):
            for w in seg.words or []:
                t = (w.word or "").strip()
                if not t:
                    continue
                words.append(
                    {
                        "start": round(float(w.start), 3),
                        "end": round(float(w.end), 3),
                        "word": t,
                    }
                )

    seg_out, words_out = _write_outputs(work_dir, segments, words)
    return segments, words, seg_out, words_out, f"faster-whisper:{model_size}"


def segments_to_prompt_block(segments: list[dict[str, Any]], max_chars: int = 24000) -> str:
    """Compact transcript for the LLM with a hard cap on size."""
    lines: list[str] = []
    for s in segments:
        lines.append(f"[{s['start']:.2f}-{s['end']:.2f}] {s['text']}")
    text = "\n".join(lines)
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 80] + "\n\n[...transcript truncated for context limit...]"
