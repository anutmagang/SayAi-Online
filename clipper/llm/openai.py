"""OpenAI API resmi vs OpenRouter — env terpisah (OPENAI_* vs OPENROUTER_*)."""

from __future__ import annotations

import logging
import os
from typing import Any

from .api_key_pool import is_rate_limit_error, resolve_key_entries
from .base import LLMError, LLMProvider, LLMResult
from .pool_runtime import report_key_rate_limited, report_key_success

log = logging.getLogger(__name__)

_DEFAULT_OR_BASE = "https://openrouter.ai/api/v1"


def _legacy_openrouter_via_openai_env() -> bool:
    """Dulu: OPENAI_API_KEY + OPENAI_BASE_URL=openrouter. Masih didukung."""
    return "openrouter.ai" in os.environ.get("OPENAI_BASE_URL", "").strip().lower()


def _use_openrouter_transport(model: str) -> bool:
    """Panggilan HTTP ke host OpenRouter (bukan api.openai.com)."""
    if "/" in model.strip():
        return True
    if _legacy_openrouter_via_openai_env():
        return True
    or_k = os.environ.get("OPENROUTER_API_KEY", "").strip()
    oai_k = os.environ.get("OPENAI_API_KEY", "").strip()
    # Hanya key OR (tanpa key OpenAI resmi): semua model lewat OpenRouter.
    if or_k and not oai_k:
        return True
    return False


def _openrouter_base_url() -> str:
    raw = os.environ.get("OPENROUTER_BASE_URL", "").strip()
    if raw:
        return raw.rstrip("/")
    return _DEFAULT_OR_BASE


def _openrouter_key_entries() -> list[tuple[str | None, str]]:
    keys = resolve_key_entries("openrouter", "OPENROUTER_API_KEY")
    if keys:
        return keys
    if _legacy_openrouter_via_openai_env():
        return resolve_key_entries("openai", "OPENAI_API_KEY")
    return []


def _official_openai_key_entries() -> list[tuple[str | None, str]]:
    if _legacy_openrouter_via_openai_env():
        return []
    return resolve_key_entries("openai", "OPENAI_API_KEY")


class OpenAIProvider(LLMProvider):
    name = "openai"

    def __init__(self, model: str | None = None) -> None:
        self.model = model or os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        ref = os.environ.get("OPENROUTER_HTTP_REFERER", "").strip()
        title = os.environ.get("OPENROUTER_APP_TITLE", "").strip()
        headers: dict[str, str] = {}
        if ref:
            headers["HTTP-Referer"] = ref
        if title:
            headers["X-Title"] = title
        self._extra_headers = headers

    def _client_kwargs_openrouter(self, api_key: str) -> dict[str, Any]:
        kw: dict[str, Any] = {
            "api_key": api_key,
            "base_url": _openrouter_base_url(),
        }
        if self._extra_headers:
            kw["default_headers"] = self._extra_headers
        return kw

    def _client_kwargs_official(self, api_key: str) -> dict[str, Any]:
        base = os.environ.get("OPENAI_BASE_URL", "").strip() or None
        kw: dict[str, Any] = {"api_key": api_key}
        if base:
            kw["base_url"] = base.rstrip("/")
        if self._extra_headers:
            kw["default_headers"] = self._extra_headers
        return kw

    def is_available(self) -> bool:
        if _use_openrouter_transport(self.model):
            return bool(_openrouter_key_entries())
        return bool(_official_openai_key_entries())

    def complete_json(self, *, system: str, user: str, max_tokens: int) -> LLMResult:
        try:
            from openai import OpenAI  # type: ignore
        except ImportError as e:
            raise LLMError(f"openai sdk missing: {e}") from e

        if _use_openrouter_transport(self.model):
            entries = resolve_key_entries("openrouter", "OPENROUTER_API_KEY")
            pool_provider = "openrouter"
            if not entries and _legacy_openrouter_via_openai_env():
                entries = resolve_key_entries("openai", "OPENAI_API_KEY")
                pool_provider = "openai"
            if not entries:
                raise LLMError(
                    "OpenRouter: set OPENROUTER_API_KEY (atau legacy OPENAI_API_KEY "
                    "+ OPENAI_BASE_URL=https://openrouter.ai/api/v1)"
                )
            kwargs_fn = self._client_kwargs_openrouter
        else:
            entries = _official_openai_key_entries()
            pool_provider = "openai"
            if not entries:
                raise LLMError("OPENAI_API_KEY not set (API OpenAI resmi)")
            kwargs_fn = self._client_kwargs_official

        for i, (pool_id, api_key) in enumerate(entries):
            client = OpenAI(**kwargs_fn(api_key))
            try:
                resp = client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    max_tokens=max_tokens,
                    temperature=0.4,
                    response_format={"type": "json_object"},
                )
            except Exception as e:
                if is_rate_limit_error(e):
                    if pool_id:
                        report_key_rate_limited(pool_id, pool_provider, str(e))
                    if i < len(entries) - 1:
                        log.warning(
                            "openai-compatible rate limited, trying next API key (%s/%s)",
                            i + 1,
                            len(entries),
                        )
                        continue
                raise LLMError(f"openai call failed: {e}") from e

            text = (resp.choices[0].message.content or "").strip()
            if not text:
                raise LLMError("openai returned empty content")
            if pool_id:
                report_key_success(pool_id, pool_provider)
            return LLMResult(text=text, provider=self.name, model=self.model)
