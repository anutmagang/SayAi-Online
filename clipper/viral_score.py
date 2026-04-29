from __future__ import annotations

import re


def viral_score_for_clip(
    clip_start: float,
    clip_end: float,
    label: str,
    word_count: int,
    *,
    post_caption: str = "",
    hashtags: str = "",
) -> int:
    """
    Lightweight 0–100 heuristic for short-form “viral potential” (Phase 4 analytics).
    Not predictive; useful for sorting and dashboard aggregates.
    Optional caption + hashtag fields add a small bonus when present (social-ready).
    """
    duration = max(0.25, clip_end - clip_start)
    # Baseline diset agar klip “layak” dengan label + caption sering ≥85 setelah bonus wps/hook/tag.
    score = 48.0

    if 20.0 <= duration <= 55.0:
        score += 20.0
    elif 15.0 <= duration <= 75.0:
        score += 12.0

    wps = word_count / duration
    if wps >= 2.5:
        score += 18.0
    elif wps >= 1.6:
        score += 10.0
    elif wps >= 1.0:
        score += 5.0

    low = (label or "").lower()
    hooks = (
        # ID
        "rahasia",
        "tips",
        "tip",
        "gratis",
        "viral",
        "jangan",
        "bahaya",
        "error",
        "salah",
        "kenapa",
        "cara",
        # EN (shorts hooks)
        "secret",
        "hack",
        "free",
        "mistake",
        "wrong",
        "why",
        "how",
        "never",
        "stop",
        "truth",
        "exposed",
        "shocking",
    )
    if any(h in low for h in hooks):
        score += 8.0

    cap = (post_caption or "").strip()
    if 90 <= len(cap) <= 520:
        score += 5.0
    elif 45 <= len(cap) <= 650:
        score += 2.0

    tags = (hashtags or "").strip()
    n_tag = len(re.findall(r"#[\w\u0080-\uFFFF]{2,}", tags, flags=re.UNICODE))
    if 6 <= n_tag <= 14:
        score += 7.0
    elif 4 <= n_tag <= 16:
        score += 4.0
    elif n_tag >= 2:
        score += 2.0

    return int(max(0, min(100, round(score))))
