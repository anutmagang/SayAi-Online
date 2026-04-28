"""Allowed chat model IDs per provider (must match web/lib/llm-models.ts).

Groq: IDs produksi / preview dari dokumentasi GroqCloud (~Apr 2026).
Gemini: subset yang mendukung generateContent (bukan image/TTS-only).
OpenAI resmi: ID gpt-* (tanpa slash). OpenRouter: slug `vendor/model` bila
        OPENROUTER_API_KEY di-set atau legacy OPENAI_BASE_URL → openrouter.ai.
"""

from __future__ import annotations

import os
import re

ALLOWED_LLM_MODELS: dict[str, frozenset[str]] = {
    "groq": frozenset(
        {
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "openai/gpt-oss-20b",
            "openai/gpt-oss-120b",
            "meta-llama/llama-4-scout-17b-16e-instruct",
            "qwen/qwen3-32b",
        }
    ),
    "gemini": frozenset(
        {
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite",
            "gemini-2.5-pro",
            "gemini-2.0-flash",
            "gemini-2.0-flash-001",
            "gemini-2.0-flash-lite",
            "gemini-2.0-flash-lite-001",
            "gemini-flash-latest",
            "gemini-flash-lite-latest",
            "gemini-pro-latest",
            "gemini-1.5-flash",
            "gemini-1.5-pro",
        }
    ),
    "openai": frozenset(
        {
            "gpt-4o",
            "gpt-4o-mini",
            "gpt-4-turbo",
            # OpenRouter (https://openrouter.ai/models) — contoh umum:
            "deepseek/deepseek-chat",
            "deepseek/deepseek-r1",
            "openai/gpt-4o-mini",
            "openai/gpt-4o",
            "anthropic/claude-3.5-sonnet",
            "google/gemini-2.0-flash-001",
            "meta-llama/llama-3.3-70b-instruct",
        }
    ),
    "anthropic": frozenset(
        {
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
            "claude-3-opus-20240229",
        }
    ),
}


_OR_SLUG = re.compile(
    r"^[a-z0-9][a-z0-9._-]{0,63}/[a-z0-9][a-z0-9._-]{0,63}$",
    re.IGNORECASE,
)


def sanitized_model_for_provider(provider: str, model_id: str | None) -> str | None:
    """Return model_id if allowed for provider, else None (caller uses env default)."""
    if not model_id:
        return None
    mid = model_id.strip()
    if len(mid) > 120:
        return None
    allowed = ALLOWED_LLM_MODELS.get(provider)
    if allowed and mid in allowed:
        return mid
    if provider == "openai" and _using_openrouter():
        if _OR_SLUG.match(mid):
            return mid
    return None


def _using_openrouter() -> bool:
    if os.environ.get("OPENROUTER_API_KEY", "").strip():
        return True
    base = os.environ.get("OPENAI_BASE_URL", "").strip().lower()
    return "openrouter.ai" in base
