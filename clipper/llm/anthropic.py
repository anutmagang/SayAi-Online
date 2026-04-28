"""Anthropic Claude provider — top-end quality for Pro tier."""

from __future__ import annotations

import logging
import os

from .api_key_pool import is_rate_limit_error, resolve_key_entries
from .base import LLMError, LLMProvider, LLMResult
from .pool_runtime import report_key_rate_limited, report_key_success

log = logging.getLogger(__name__)


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self, model: str | None = None) -> None:
        self.model = model or os.environ.get(
            "ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022"
        )

    def is_available(self) -> bool:
        return bool(resolve_key_entries("anthropic", "ANTHROPIC_API_KEY"))

    def complete_json(self, *, system: str, user: str, max_tokens: int) -> LLMResult:
        entries = resolve_key_entries("anthropic", "ANTHROPIC_API_KEY")
        if not entries:
            raise LLMError("ANTHROPIC_API_KEY not set")
        try:
            import anthropic  # type: ignore
        except ImportError as e:
            raise LLMError(f"anthropic sdk missing: {e}") from e

        for i, (pool_id, api_key) in enumerate(entries):
            client = anthropic.Anthropic(api_key=api_key)
            try:
                msg = client.messages.create(
                    model=self.model,
                    max_tokens=max_tokens,
                    system=system,
                    messages=[{"role": "user", "content": user}],
                    temperature=0.4,
                )
            except Exception as e:
                if is_rate_limit_error(e):
                    if pool_id:
                        report_key_rate_limited(pool_id, "anthropic", str(e))
                    if i < len(entries) - 1:
                        log.warning(
                            "anthropic rate limited, trying next API key (%s/%s)",
                            i + 1,
                            len(entries),
                        )
                        continue
                raise LLMError(f"anthropic call failed: {e}") from e

            parts = []
            for block in msg.content or []:
                text = getattr(block, "text", None)
                if text:
                    parts.append(text)
            text = "".join(parts).strip()
            if not text:
                raise LLMError("anthropic returned empty content")
            if pool_id:
                report_key_success(pool_id, "anthropic")
            return LLMResult(text=text, provider=self.name, model=self.model)
