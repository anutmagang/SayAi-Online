"""Groq provider — free Llama 3.3 70B, very fast (~500 tok/s)."""

from __future__ import annotations

import logging
import os

from .api_key_pool import is_rate_limit_error, resolve_key_entries
from .base import LLMError, LLMProvider, LLMResult
from .pool_runtime import report_key_rate_limited, report_key_success

log = logging.getLogger(__name__)


class GroqProvider(LLMProvider):
    name = "groq"

    def __init__(self, model: str | None = None) -> None:
        self.model = model or os.environ.get(
            "GROQ_LLM_MODEL", "llama-3.3-70b-versatile"
        )

    def is_available(self) -> bool:
        return bool(resolve_key_entries("groq", "GROQ_API_KEY"))

    def complete_json(self, *, system: str, user: str, max_tokens: int) -> LLMResult:
        entries = resolve_key_entries("groq", "GROQ_API_KEY")
        if not entries:
            raise LLMError("GROQ_API_KEY not set")
        try:
            from groq import Groq  # type: ignore
        except ImportError as e:
            raise LLMError(f"groq sdk missing: {e}") from e

        for i, (pool_id, api_key) in enumerate(entries):
            client = Groq(api_key=api_key)
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
                        report_key_rate_limited(pool_id, "groq", str(e))
                    if i < len(entries) - 1:
                        log.warning(
                            "groq rate limited, trying next API key (%s/%s)",
                            i + 1,
                            len(entries),
                        )
                        continue
                raise LLMError(f"groq call failed: {e}") from e

            text = (resp.choices[0].message.content or "").strip()
            if not text:
                raise LLMError("groq returned empty content")
            if pool_id:
                report_key_success(pool_id, "groq")
            return LLMResult(text=text, provider=self.name, model=self.model)
