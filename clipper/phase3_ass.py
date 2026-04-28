from __future__ import annotations

import re
from pathlib import Path


def _ass_escape(text: str) -> str:
    t = text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
    t = re.sub(r"[\r\n]+", " ", t)
    return t


def ass_timestamp(t: float) -> str:
    """H:MM:SS.cc for ASS (centiseconds)."""
    if t < 0:
        t = 0.0
    h = int(t // 3600)
    t -= h * 3600
    m = int(t // 60)
    t -= m * 60
    s = int(t)
    cs = int(round((t - s) * 100.0)) % 100
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def write_karaoke_ass(
    path: Path,
    words_relative: list[tuple[float, float, str]],
    playres_x: int,
    playres_y: int,
    *,
    clip_timeline_sec: float | None = None,
) -> None:
    """
    Word-by-word karaoke using ASS \\k (centisecond) timing.
    words_relative: (start_sec, end_sec, word) on clip-local timeline [0, duration].
    clip_timeline_sec: full clip length (Dialogue end); defaults to last word end.
    """
    if not words_relative:
        raise ValueError("No words for ASS")

    words_sorted = sorted(words_relative, key=lambda x: x[0])
    parts: list[str] = []
    prev_end = 0.0
    for st, en, word in words_sorted:
        gap = st - prev_end
        if gap >= 0.005:
            g_cs = max(1, int(round(gap * 100.0)))
            parts.append(f"{{\\k{g_cs}}}")  # silent beat before next word
        dur = max(0.01, en - st)
        cs = max(1, int(round(dur * 100.0)))
        wesc = _ass_escape(word.strip()) or "…"
        parts.append(f"{{\\k{cs}}}{wesc}")
        prev_end = en

    last_word_end = max(w[1] for w in words_sorted)
    timeline = max(
        clip_timeline_sec if clip_timeline_sec is not None else 0.0,
        last_word_end,
        prev_end,
        0.5,
    )

    text = "".join(parts)
    start = ass_timestamp(0.0)
    end = ass_timestamp(timeline)

    header = f"""[Script Info]
Title: Fai-Clipper captions
ScriptType: v4.00+
PlayResX: {playres_x}
PlayResY: {playres_y}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,52,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,3,1,2,40,40,160,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,{start},{end},Default,,0,0,0,,{text}
"""
    path.write_text("\ufeff" + header, encoding="utf-8")


def words_for_clip(
    all_words: list[dict],
    clip_start: float,
    clip_end: float,
) -> list[tuple[float, float, str]]:
    """Map global whisper times to clip-relative (0-based) intervals."""
    dur = clip_end - clip_start
    out: list[tuple[float, float, str]] = []
    for w in all_words:
        try:
            ws = float(w["start"])
            we = float(w["end"])
            word = str(w.get("word", "")).strip()
        except (KeyError, TypeError, ValueError):
            continue
        if not word:
            continue
        if we <= clip_start or ws >= clip_end:
            continue
        a = max(0.0, ws - clip_start)
        b = min(dur, we - clip_start)
        if b <= a:
            continue
        out.append((a, b, word))
    out.sort(key=lambda x: x[0])
    return out
