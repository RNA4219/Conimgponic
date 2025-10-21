"""tests for tools.perf.context_trimmer"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict, List
import importlib
import sys

import pytest


def _reload_context_trimmer(fake_tiktoken: Any | None) -> Any:
    for name in list(sys.modules):
        if name.startswith("tools.perf.context_trimmer"):
            sys.modules.pop(name)
    if fake_tiktoken is None:
        sys.modules.pop("tiktoken", None)
    else:
        sys.modules["tiktoken"] = fake_tiktoken
    return importlib.import_module("tools.perf.context_trimmer")


def _messages() -> List[Dict[str, str]]:
    return [
        {"role": "system", "content": "stay concise"},
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi there"},
        {"role": "user", "content": "tell me more"},
    ]


def test_trim_messages_preserves_first_system(monkeypatch: pytest.MonkeyPatch) -> None:
    module = _reload_context_trimmer(fake_tiktoken=None)
    messages = [
        {"role": "system", "content": "original"},
        {"role": "user", "content": "question"},
        {"role": "system", "content": "should drop"},
        {"role": "assistant", "content": "answer"},
    ]
    result = module.trim_messages(messages, max_context_tokens=12, model="fake")
    trimmed = result["messages"]
    assert trimmed[0]["role"] == "system"
    assert trimmed[0]["content"] == "original"
    assert sum(1 for m in trimmed if m["role"] == "system") == 1


def test_trim_messages_counts_tokens_with_tiktoken() -> None:
    fake_encoding = SimpleNamespace(
        name="fake-encoding",
        encode=lambda text: [1] * len(text.split()),
    )
    fake_tiktoken = SimpleNamespace(
        encoding_for_model=lambda model: fake_encoding,
        get_encoding=lambda name: fake_encoding,
    )
    module = _reload_context_trimmer(fake_tiktoken=fake_tiktoken)
    result = module.trim_messages(_messages(), max_context_tokens=100, model="test-model")
    stats = result["statistics"]
    assert stats["input_tokens"] == stats["output_tokens"] == 4 * len(_messages()) + sum(
        len(message["content"].split()) for message in _messages()
    )
    assert result["token_counter"]["uses_tiktoken"] is True
    assert result["token_counter"]["encoding"] == "fake-encoding"


def test_trim_messages_counts_tokens_without_tiktoken() -> None:
    module = _reload_context_trimmer(fake_tiktoken=None)
    result = module.trim_messages(_messages(), max_context_tokens=100, model="test-model")
    stats = result["statistics"]
    assert stats["input_tokens"] == stats["output_tokens"]
    expected = sum(max(1, len(m["content"]) // 4 + 1) + 4 for m in _messages())
    assert stats["output_tokens"] == expected
    assert result["token_counter"]["uses_tiktoken"] is False
