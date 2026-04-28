"""Common interface every LLM provider implements."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class LLMError(RuntimeError):
    """Raised when a provider fails in a way that should fall back to the next one."""


@dataclass(frozen=True)
class LLMResult:
    """Raw text returned by the provider. Parsing is done by the caller."""

    text: str
    provider: str
    model: str


class LLMProvider(Protocol):
    """Minimal surface we need: one call, one JSON-array text back."""

    name: str  # e.g. "groq", "openai"
    model: str  # e.g. "llama-3.3-70b-versatile"

    def is_available(self) -> bool: ...

    def complete_json(self, *, system: str, user: str, max_tokens: int) -> LLMResult: ...
