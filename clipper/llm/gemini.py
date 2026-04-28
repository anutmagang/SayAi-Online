"""Google Gemini provider — 1.5 Pro for paid tier, 2.0 Flash for starter."""

from __future__ import annotations

import logging
import os

from .api_key_pool import is_rate_limit_error, resolve_key_entries
from .base import LLMError, LLMProvider, LLMResult
from .pool_runtime import report_key_rate_limited, report_key_success

log = logging.getLogger(__name__)


class GeminiProvider(LLMProvider):
    name = "gemini"

    def __init__(self, model: str | None = None) -> None:
        self.model = model or os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

    def is_available(self) -> bool:
        return bool(resolve_key_entries("gemini", "GEMINI_API_KEY"))

    def complete_json(self, *, system: str, user: str, max_tokens: int) -> LLMResult:
        entries = resolve_key_entries("gemini", "GEMINI_API_KEY")
        if not entries:
            raise LLMError("GEMINI_API_KEY not set")
        try:
            import google.generativeai as genai  # type: ignore
        except ImportError as e:
            raise LLMError(f"google-generativeai missing: {e}") from e

        for i, (pool_id, api_key) in enumerate(entries):
            genai.configure(api_key=api_key)
            try:
                model = genai.GenerativeModel(
                    model_name=self.model,
                    system_instruction=system,
                    generation_config={
                        "max_output_tokens": max_tokens,
                        "temperature": 0.4,
                        "response_mime_type": "application/json",
                    },
                )
                resp = model.generate_content(user)
            except Exception as e:
                if is_rate_limit_error(e):
                    if pool_id:
                        report_key_rate_limited(pool_id, "gemini", str(e))
                    if i < len(entries) - 1:
                        log.warning(
                            "gemini rate limited, trying next API key (%s/%s)",
                            i + 1,
                            len(entries),
                        )
                        continue
                raise LLMError(f"gemini call failed: {e}") from e

            text = (getattr(resp, "text", "") or "").strip()
            if not text:
                raise LLMError("gemini returned empty content")
            if pool_id:
                report_key_success(pool_id, "gemini")
            return LLMResult(text=text, provider=self.name, model=self.model)
