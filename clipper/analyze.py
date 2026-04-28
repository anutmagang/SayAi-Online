"""Turn a transcript into a list of clip suggestions via an LLM.

Provider choice goes through `clipper.llm.pick_provider`, which selects among
Groq / Gemini / OpenAI / Anthropic based on the user's tier and preference.
Free tier tries Groq first, then Gemini if Groq fails (see `router._TIER_FALLBACK`).
Pro can pin a specific vendor.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from clipper.config import Settings
from clipper.llm import LLMError, LLMResult, pick_provider

log = logging.getLogger(__name__)


def _normalize_hashtags(raw: Any) -> str:
    """LLM may return list of #tags or one string; normalize to space-separated."""
    if raw is None:
        return ""
    if isinstance(raw, list):
        parts: list[str] = []
        for x in raw:
            s = str(x).strip()
            if not s:
                continue
            if not s.startswith("#"):
                s = f"#{s.lstrip('#')}"
            parts.append(s)
        return " ".join(parts[:18])[:1500]
    s = str(raw).strip()
    return s[:1500]


def _normalize_caption(raw: Any) -> str:
    if raw is None:
        return ""
    return str(raw).strip()[:2000]


@dataclass(frozen=True)
class ClipSuggestion:
    start_sec: float
    end_sec: float
    label: str
    post_caption: str = ""
    hashtags: str = ""


@dataclass(frozen=True)
class AnalyzeOutput:
    clips: list[ClipSuggestion]
    provider: str
    model: str


def _extract_json_array(text: str) -> list[dict[str, Any]]:
    """Accept either a raw JSON array, a `{"clips": [...]}` wrapper,
    or fenced-markdown output. Also tolerates single trailing commas.
    """
    cleaned = text.strip()
    fence = re.match(r"^```(?:json)?\s*([\s\S]*?)\s*```$", cleaned, re.IGNORECASE)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        # Fallback: find the first [...] block in the response.
        match = re.search(r"\[\s*[\s\S]*?\s*\]", cleaned)
        if not match:
            raise
        data = json.loads(match.group(0))
    if isinstance(data, dict):
        for key in ("clips", "highlights", "items", "data"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
        else:
            raise ValueError("Model returned JSON object without 'clips' array")
    if not isinstance(data, list):
        raise ValueError("Expected a JSON array of clips")
    return data


def _prompt(settings: Settings, transcript_block: str, duration: float) -> tuple[str, str]:
    system = (
        "You are a short-form video editor and social growth assistant. From the "
        "transcript, pick the most engaging vertical-ready highlight clips. Prefer "
        "moments with a clear hook, punchline, or surprising claim. Respond with "
        "JSON only: "
        '{"clips": [{"start_sec": number, "end_sec": number, "label": string, '
        '"post_caption": string, "hashtags": string[]}]}.\n'
        "Times are seconds from the start of the source video. Each clip should "
        "be self-contained (begin at a thought start) and fall within the "
        "requested duration range when possible.\n"
        "For `label`: punchy 3–8 word on-screen title (hook-style), same language "
        "as the transcript.\n"
        "For `post_caption`: 1–4 sentences ready to paste as the video description "
        "(same language as transcript). Include a light CTA when natural "
        "(e.g. follow, comment, save). Avoid clickbait that contradicts the clip; "
        "you may use a few tasteful emojis if it fits the niche.\n"
        "For `hashtags`: 8–14 strings, each starting with #. Mix 2–3 broad tags "
        "(topic/language) with niche/long-tail tags relevant to this exact moment. "
        "SEO-friendly: no duplicate tags, no stuffing of the same word, no "
        "off-topic trending abuse. Prefer Indonesian tags if the transcript is "
        "Indonesian; otherwise match the transcript language."
    )
    user = (
        f"Video duration seconds: {duration:.2f}\n"
        f"Target clip count: up to {settings.max_clips}.\n"
        f"Preferred clip duration: {settings.clip_min_duration:.0f}-"
        f"{settings.clip_max_duration:.0f} seconds.\n\n"
        "Transcript with rough timestamps:\n"
        f"{transcript_block}\n"
    )
    return system, user


def suggest_clips(
    settings: Settings,
    transcript_block: str,
    video_duration_sec: float,
) -> AnalyzeOutput:
    system, user = _prompt(settings, transcript_block, video_duration_sec)

    try:
        result: LLMResult = pick_provider(
            system=system,
            user=user,
            max_tokens=4096,
            tier=settings.user_tier,
            preference=settings.llm_preference,
            pinned_model=settings.llm_model_id or None,
        )
    except LLMError as e:
        raise RuntimeError(
            f"No LLM provider succeeded. Configure at least GROQ_API_KEY. ({e})"
        ) from e

    try:
        items = _extract_json_array(result.text)
    except (ValueError, json.JSONDecodeError) as e:
        log.error("llm=%s raw=%s", result.provider, result.text[:500])
        raise RuntimeError(
            f"LLM {result.provider}/{result.model} returned unparseable JSON: {e}"
        ) from e

    clips: list[ClipSuggestion] = []
    for obj in items:
        if not isinstance(obj, dict):
            continue
        if "start_sec" not in obj or "end_sec" not in obj:
            continue
        try:
            clips.append(
                ClipSuggestion(
                    start_sec=float(obj["start_sec"]),
                    end_sec=float(obj["end_sec"]),
                    label=str(obj.get("label", "") or "").strip(),
                    post_caption=_normalize_caption(obj.get("post_caption")),
                    hashtags=_normalize_hashtags(obj.get("hashtags")),
                )
            )
        except (TypeError, ValueError):
            continue

    if not clips:
        raise RuntimeError(
            f"LLM {result.provider}/{result.model} returned no usable clips."
        )

    return AnalyzeOutput(
        clips=clips[: settings.max_clips],
        provider=result.provider,
        model=result.model,
    )


def clamp_clips(
    clips: list[ClipSuggestion],
    duration: float,
    min_d: float,
    max_d: float,
) -> list[ClipSuggestion]:
    """Normalise start/end, drop invalid/too-short/duplicate entries, and
    merge overlapping windows. Result is sorted by start time.
    """
    if duration <= 0:
        return []

    fixed: list[ClipSuggestion] = []
    for c in clips:
        try:
            start = max(0.0, min(float(c.start_sec), max(0.0, duration - 1.0)))
            end = max(start + 0.5, min(float(c.end_sec), duration))
        except (TypeError, ValueError):
            continue
        if end - start < min_d:
            end = min(duration, start + min_d)
        if end - start > max_d:
            end = start + max_d
        if end > duration:
            end = duration
            start = max(0.0, end - min_d)
        if end - start < 1.0:
            continue
        fixed.append(
            ClipSuggestion(
                start_sec=start,
                end_sec=end,
                label=c.label,
                post_caption=c.post_caption,
                hashtags=c.hashtags,
            )
        )

    fixed.sort(key=lambda x: (x.start_sec, x.end_sec))

    deduped: list[ClipSuggestion] = []
    for c in fixed:
        if deduped:
            last = deduped[-1]
            # Near-duplicate (within 1s start & 1s end): skip.
            if abs(c.start_sec - last.start_sec) < 1.0 and abs(c.end_sec - last.end_sec) < 1.0:
                continue
            # Heavy overlap (>70% of the shorter clip): skip the later one.
            overlap_start = max(c.start_sec, last.start_sec)
            overlap_end = min(c.end_sec, last.end_sec)
            overlap = max(0.0, overlap_end - overlap_start)
            shorter = min(c.end_sec - c.start_sec, last.end_sec - last.start_sec)
            if shorter > 0 and (overlap / shorter) > 0.7:
                continue
        deduped.append(c)
    return deduped
