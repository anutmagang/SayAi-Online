"""Pick the best LLM provider given tier + preference + available keys."""

from __future__ import annotations

import logging
from typing import Sequence

from .anthropic import AnthropicProvider
from .base import LLMError, LLMProvider, LLMResult
from .gemini import GeminiProvider
from .groq import GroqProvider
from .model_allowlist import sanitized_model_for_provider
from .openai import OpenAIProvider

log = logging.getLogger(__name__)

# Order matters: router tries providers left-to-right until one succeeds.
# Free: Gemini (free API cenderung lebih ketat / RPM lebih kecil) dulu, Groq fallback.
_TIER_FALLBACK: dict[str, tuple[str, ...]] = {
    "free": ("gemini", "groq"),
    "starter": ("groq", "gemini"),
    "creator": ("gemini", "groq", "openai"),
    "pro": ("anthropic", "openai", "gemini", "groq"),
}

_PROVIDERS = {
    "groq": GroqProvider,
    "gemini": GeminiProvider,
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
}


def _effective_tier(tier: str) -> str:
    t = tier if tier in _TIER_FALLBACK else "free"
    return t


def _model_override_for_provider(
    provider_name: str, preference: str, pinned_model: str | None
) -> str | None:
    if preference == "auto" or preference != provider_name:
        return None
    return sanitized_model_for_provider(provider_name, pinned_model)


def build_providers_for_tier(
    tier: str,
    preference: str = "auto",
    pinned_model: str | None = None,
) -> list[LLMProvider]:
    """Return a ranked list of providers to try, after filtering to the ones
    with API keys actually set in the environment.

    - `preference` lets a Pro user pin a specific vendor. If pinned and available,
      it goes first; otherwise we fall back to the tier chain.
    - `tier` picks the default chain (see `_TIER_FALLBACK`).
    - `pinned_model` applies only when `preference` matches that provider name.
    """
    tier = _effective_tier(tier)
    chain = list(_TIER_FALLBACK[tier])

    if preference in _PROVIDERS and preference not in chain:
        chain.insert(0, preference)
    elif preference in _PROVIDERS:
        # Already in chain — bubble to the front.
        chain.remove(preference)
        chain.insert(0, preference)

    built: list[LLMProvider] = []
    for name in chain:
        factory = _PROVIDERS.get(name)
        if not factory:
            continue
        model_kw = _model_override_for_provider(name, preference, pinned_model)
        try:
            p = factory(model=model_kw)
        except Exception as e:
            log.warning("provider %s init failed: %s", name, e)
            continue
        if p.is_available():
            built.append(p)
    return built


def pick_provider(
    *,
    system: str,
    user: str,
    max_tokens: int,
    tier: str,
    preference: str = "auto",
    pinned_model: str | None = None,
) -> LLMResult:
    """Try providers in order until one succeeds; raise LLMError if all fail."""
    providers = build_providers_for_tier(tier, preference, pinned_model)
    if not providers:
        raise LLMError(
            "No LLM provider available. Set GROQ_API_KEY at minimum "
            "(free, recommended), or GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY."
        )

    last_error: Exception | None = None
    for p in providers:
        log.info("llm: trying provider=%s model=%s", p.name, p.model)
        try:
            result = p.complete_json(system=system, user=user, max_tokens=max_tokens)
            log.info("llm: success provider=%s", p.name)
            return result
        except LLMError as e:
            last_error = e
            log.warning("llm: provider=%s failed: %s", p.name, e)
            continue
    raise LLMError(
        f"All configured LLM providers failed. Last error: {last_error}"
    ) from last_error


def _available_provider_names() -> Sequence[str]:
    """Helper for logging/diagnostics."""
    out = []
    for name, factory in _PROVIDERS.items():
        try:
            if factory().is_available():
                out.append(name)
        except Exception:
            pass
    return out
