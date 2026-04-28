"""LLM provider abstraction for clip suggestion.

Picks a provider based on user tier + preference + available API keys.
Each provider returns a plain list[dict] from a single prompt call,
so the top-level clipper pipeline does not need to know the vendor.

Tier routing (in `pick_provider`):
  - free -> Gemini lalu Groq (pakai pool free yang lebih ketat dulu; lihat `router._TIER_FALLBACK`)
  - starter -> Groq + Gemini
  - pro (pref = anthropic)    -> Anthropic Claude
  - pro (pref = openai)       -> OpenAI GPT-4o
  - pro (pref = gemini)       -> Google Gemini 1.5 Pro
  - pro (pref = auto/groq)    -> Groq (fallback to Gemini/OpenAI on failure)

Fallback chain kicks in automatically when a provider is missing its API key
or raises an exception. This keeps one bad key from breaking the whole app.
"""

from __future__ import annotations

from .base import LLMProvider, LLMResult, LLMError
from .router import pick_provider, build_providers_for_tier

__all__ = [
    "LLMProvider",
    "LLMResult",
    "LLMError",
    "pick_provider",
    "build_providers_for_tier",
]
