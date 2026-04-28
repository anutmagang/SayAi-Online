"""Settings loaded from environment variables.

The pipeline is vendor-agnostic: set GEMINI_API_KEY and/or GROQ_API_KEY for free
tier (router tries Gemini first, then Groq). Paid tiers pick from more vendors
if their keys exist.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    # LLM
    user_tier: str  # "free" | "starter" | "creator" | "pro"
    llm_preference: str  # "auto" | "groq" | "gemini" | "openai" | "anthropic"
    llm_model_id: str  # optional; used when llm_preference matches that provider

    # Whisper
    whisper_model_size: str
    prefer_groq_whisper: bool
    groq_whisper_model: str

    # Clip shaping
    clip_min_duration: float
    clip_max_duration: float
    max_clips: int

    # Render
    # output_layout: short_vertical (9:16 Shorts/Reels) | long_horizontal (16:9).
    output_layout: str
    # True bila output 9:16 (layout Shorts/Reels); selalu aktif untuk short_vertical.
    phase3_vertical: bool
    # Produk: tidak pernah membakar subtitle/karaoke di video (caption hanya di dashboard).
    phase3_burn_captions: bool
    vertical_width: int
    vertical_height: int
    watermark_text: str  # "" disables watermark
    watermark_position: str  # drawtext anchor: top_left | top_right | ...

    # Tier limits
    max_source_duration_sec: int  # reject videos longer than this (per tier)

    # Observability
    job_events_url: str  # Supabase endpoint to POST job_events (optional)
    job_events_token: str
    job_id: str  # current job id (for events) — optional
    user_id: str  # current user id — optional


def _bool(key: str, default: str = "1") -> bool:
    return os.environ.get(key, default).strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
        "",
    )


def _max_clips_cap_for_tier(tier: str) -> int:
    """Selaras `web/lib/tiers.ts` MAX_CLIPS_PER_JOB_BY_TIER."""
    return {"free": 5, "starter": 10, "creator": 15, "pro": 20}.get(tier, 5)


def load_settings() -> Settings:
    tier = os.environ.get("USER_TIER", "free").strip().lower()
    if tier not in ("free", "starter", "creator", "pro"):
        tier = "free"

    pref = os.environ.get("LLM_PREFERENCE", "auto").strip().lower()
    if pref not in ("auto", "groq", "gemini", "openai", "anthropic"):
        pref = "auto"

    llm_mid = os.environ.get("LLM_MODEL_ID", "").strip()

    forced_wm = os.environ.get("WATERMARK_TEXT", "").strip()
    wm_pos = os.environ.get("WATERMARK_POSITION", "bottom_right").strip().lower()
    if wm_pos not in ("top_left", "top_right", "bottom_left", "bottom_right", "center"):
        wm_pos = "bottom_right"

    if forced_wm:
        watermark = forced_wm
    elif tier == "free":
        watermark = os.environ.get("FREE_TIER_WATERMARK_TEXT", "Fai-Clipper").strip()
    else:
        wm_paid = os.environ.get("WATERMARK_PAID_ENABLED", "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        wm_custom = os.environ.get("WATERMARK_CUSTOM_TEXT", "").strip()
        if wm_paid and wm_custom:
            watermark = wm_custom
        else:
            watermark = ""

    # Per-tier source-duration cap (seconds).
    # Free: 1h (cost containment). Starter/Creator/Pro: 2h.
    default_max_dur = 3600 if tier == "free" else 7200
    max_source_dur = int(os.environ.get("MAX_SOURCE_DURATION_SEC", str(default_max_dur)))

    raw_max_clips = int(os.environ.get("MAX_CLIPS", "8"))
    clip_cap = _max_clips_cap_for_tier(tier)
    max_clips = max(1, min(raw_max_clips, clip_cap))

    ol_raw = os.environ.get("CLIPPER_OUTPUT_LAYOUT", "short_vertical").strip().lower()
    output_layout = (
        ol_raw if ol_raw in ("short_vertical", "long_horizontal") else "short_vertical"
    )
    phase3_vertical = (
        _bool("PHASE3_VERTICAL", "1") if output_layout == "short_vertical" else False
    )

    return Settings(
        user_tier=tier,
        llm_preference=pref,
        llm_model_id=llm_mid,
        whisper_model_size=os.environ.get("WHISPER_MODEL_SIZE", "small").strip(),
        prefer_groq_whisper=_bool("PREFER_GROQ_WHISPER", "1"),
        groq_whisper_model=os.environ.get(
            "GROQ_WHISPER_MODEL", "whisper-large-v3-turbo"
        ).strip(),
        clip_min_duration=float(os.environ.get("CLIP_MIN_DURATION", "20")),
        clip_max_duration=float(os.environ.get("CLIP_MAX_DURATION", "90")),
        max_clips=max_clips,
        output_layout=output_layout,
        phase3_vertical=phase3_vertical,
        phase3_burn_captions=False,
        vertical_width=int(os.environ.get("VERTICAL_OUT_W", "1080")),
        vertical_height=int(os.environ.get("VERTICAL_OUT_H", "1920")),
        watermark_text=watermark,
        watermark_position=wm_pos,
        max_source_duration_sec=max_source_dur,
        job_events_url=os.environ.get("JOB_EVENTS_URL", "").strip(),
        job_events_token=os.environ.get("JOB_EVENTS_TOKEN", "").strip(),
        job_id=os.environ.get("CLIPPER_JOB_ID", "").strip(),
        user_id=os.environ.get("CLIPPER_USER_ID", "").strip(),
    )
