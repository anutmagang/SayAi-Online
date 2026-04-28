"""Turn a transcript into a list of clip suggestions via an LLM.

Providers are ranked via `build_providers_for_tier`. Each candidate is tried in order:
HTTP/`complete_json` failure skips to the next; **invalid/truncated JSON** also skips
to the next (Gemini sometimes truncates long captions mid-string).
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from clipper.config import Settings
from clipper.llm import LLMError
from clipper.llm.router import build_providers_for_tier

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
        "For `post_caption`: 1–3 short sentences (under 380 characters total), same "
        "language as transcript. Include a light CTA when natural; avoid rambling.\n"
        "For `hashtags`: 6–10 strings, each starting with #. Each tag max 28 characters "
        "including #; prefer compact tags without spaces inside a tag. Mix broad + niche; "
        "no duplicates; stay on-topic. Prefer Indonesian tags if the transcript is "
        "Indonesian; otherwise match the transcript language. Keep total JSON compact "
        "so the response is complete."
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

    # Higher ceiling avoids Gemini truncating mid-string JSON on long captions/hashtags.
    max_out = 8192
    providers = build_providers_for_tier(
        settings.user_tier,
        settings.llm_preference,
        settings.llm_model_id or None,
    )
    if not providers:
        raise RuntimeError(
            "No LLM provider available. Set GROQ_API_KEY at minimum "
            "(or GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY)."
        )

    last_err: BaseException | None = None
    result_provider = ""
    result_model = ""

    for p in providers:
        try:
            result = p.complete_json(system=system, user=user, max_tokens=max_out)
        except LLMError as e:
            log.warning("llm provider=%s call failed: %s", p.name, e)
            last_err = e
            continue
        try:
            items = _extract_json_array(result.text)
        except (ValueError, json.JSONDecodeError) as e:
            log.error(
                "llm=%s model=%s unparseable JSON (%s); raw head=%s",
                p.name,
                getattr(result, "model", ""),
                e,
                (result.text or "")[:800],
            )
            last_err = e
            continue

        result_provider = result.provider
        result_model = result.model
        break
    else:
        raise RuntimeError(
            "No LLM provider returned valid JSON for clip suggestions. "
            f"Last error: {last_err}"
        ) from last_err

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
            f"LLM {result_provider}/{result_model} returned no usable clips."
        )

    return AnalyzeOutput(
        clips=clips[: settings.max_clips],
        provider=result_provider,
        model=result_model,
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
