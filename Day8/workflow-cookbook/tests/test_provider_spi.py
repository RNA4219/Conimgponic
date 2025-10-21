from __future__ import annotations

from pathlib import Path
import sys
from typing import AsyncIterator, Protocol

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.provider_spi import LLMProvider


def test_llm_provider_is_runtime_checkable_protocol() -> None:
    assert getattr(LLMProvider, "_is_runtime_protocol", False) is True
    assert issubclass(LLMProvider, Protocol)


class DummyProvider:
    async def stream(self, prompt: str, /) -> AsyncIterator[str]:
        yield prompt

    async def complete(self, prompt: str, /) -> str:
        return prompt


def test_dummy_provider_matches_protocol() -> None:
    provider = DummyProvider()

    assert isinstance(provider, LLMProvider)
