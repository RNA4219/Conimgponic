"""tests for tools.perf.context_trimmer"""

from __future__ import annotations

import importlib
import sys
from itertools import zip_longest
from math import isclose, sqrt
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, Iterable, List, Mapping, Sequence

import pytest


_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))


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


def _messages_text(messages: Iterable[Dict[str, Any]]) -> str:
    return "\n".join(str(message.get("content", "")) for message in messages)


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
    assert "compress_ratio" in stats
    assert stats["compress_ratio"] == pytest.approx(stats["compression_ratio"])
    assert stats["input_tokens"] == stats["output_tokens"] == 4 * len(_messages()) + sum(
        len(message["content"].split()) for message in _messages()
    )
    assert stats["compress_ratio"] == pytest.approx(stats["compression_ratio"])
    assert result["token_counter"]["uses_tiktoken"] is True
    assert result["token_counter"]["encoding"] == "fake-encoding"


def test_trim_messages_counts_tokens_without_tiktoken() -> None:
    module = _reload_context_trimmer(fake_tiktoken=None)
    result = module.trim_messages(_messages(), max_context_tokens=100, model="test-model")
    stats = result["statistics"]
    assert "compress_ratio" in stats
    assert stats["input_tokens"] == stats["output_tokens"]
    expected = sum(max(1, len(m["content"]) // 4 + 1) + 4 for m in _messages())
    assert stats["output_tokens"] == expected
    assert stats["compress_ratio"] == pytest.approx(stats["compression_ratio"])
    assert result["token_counter"]["uses_tiktoken"] is False


def test_trim_messages_reports_legacy_compression_ratio_key() -> None:
    module = _reload_context_trimmer(fake_tiktoken=None)
    messages = _messages()
    result = module.trim_messages(messages, max_context_tokens=100, model="test-model")
    stats = result["statistics"]

    assert list(stats)[:4] == [
        "compress_ratio",
        "compression_ratio",
        "input_tokens",
        "output_tokens",
    ]

    expected_tokens = sum(max(1, len(m["content"]) // 4 + 1) + 4 for m in messages)
    assert stats["input_tokens"] == expected_tokens
    assert stats["output_tokens"] == expected_tokens
    assert stats["compress_ratio"] == pytest.approx(1.0)
    assert stats["compression_ratio"] == pytest.approx(stats["compress_ratio"])


def test_trim_messages_records_semantic_retention() -> None:
    module = _reload_context_trimmer(fake_tiktoken=None)

    def embedder(text: str) -> List[float]:
        return [float(len(text)) or 1.0]

    result = module.trim_messages(
        _messages(),
        max_context_tokens=12,
        model="test-model",
        semantic_options={"embedder": embedder},
    )

    retention = result["statistics"]["semantic_retention"]
    assert 0.0 <= retention <= 1.0


def test_trim_messages_semantic_retention_matches_cosine_similarity() -> None:
    module = _reload_context_trimmer(fake_tiktoken=None)

    def embedder(text: str) -> List[float]:
        return [float(len(text)), float(len(text) % 3 + 1)]

    messages = _messages()
    result = module.trim_messages(
        messages,
        max_context_tokens=12,
        model="test-model",
        semantic_options={"embedder": embedder},
    )

    trimmed_messages = result["messages"]
    retention = result["statistics"]["semantic_retention"]
    assert isinstance(retention, float)
    assert 0.0 <= retention <= 1.0

    original_vector = [float(value) for value in embedder(_messages_text(messages))]
    trimmed_vector = [float(value) for value in embedder(_messages_text(trimmed_messages))]

    dot_product = sum(x * y for x, y in zip_longest(original_vector, trimmed_vector, fillvalue=0.0))
    norm_original = sqrt(sum(x * x for x in original_vector))
    norm_trimmed = sqrt(sum(y * y for y in trimmed_vector))

    if isclose(norm_original, 0.0, abs_tol=1e-12) and isclose(
        norm_trimmed, 0.0, abs_tol=1e-12
    ):
        expected = 1.0
    elif isclose(norm_original, 0.0, abs_tol=1e-12) or isclose(
        norm_trimmed, 0.0, abs_tol=1e-12
    ):
        expected = 0.0
    else:
        expected = dot_product / (norm_original * norm_trimmed)

    expected = max(0.0, min(1.0, expected))
    assert retention == pytest.approx(expected)


def test_cosine_similarity_treats_near_zero_norms_as_zero() -> None:
    module = _reload_context_trimmer(fake_tiktoken=None)

    tiny_value = 1e-12
    similarity = module._cosine_similarity([tiny_value], [tiny_value])

    assert similarity == pytest.approx(0.0)


def test_trim_messages_semantic_retention_zero_vector() -> None:
    module = _reload_context_trimmer(fake_tiktoken=None)

    def embedder(_: str) -> List[float]:
        return [0.0, 0.0]

    result = module.trim_messages(
        _messages(),
        max_context_tokens=12,
        model="test-model",
        semantic_options={"embedder": embedder},
    )

    retention = result["statistics"].get("semantic_retention")
    assert retention == 0.0


def test_measure_tokens_reports_totals() -> None:
    module = _reload_context_trimmer(fake_tiktoken=None)

    counter = module._TokenCounter("test-model")
    result = module.TokenCounterResult.from_messages(counter, _messages())

    assert isinstance(result.total_tokens, int)
    assert list(result.per_message_tokens) == [
        counter.count_message(message) for message in _messages()
    ]
    assert result.total_tokens == sum(result.per_message_tokens)


def test_select_messages_respects_budget() -> None:
    module = _reload_context_trimmer(fake_tiktoken=None)
    counter = module._TokenCounter("test-model")
    messages = _messages()
    per_message_tokens = [counter.count_message(message) for message in messages]

    trimmed = module.select_messages(messages, per_message_tokens, max_tokens=per_message_tokens[0] + 1)

    assert trimmed[0]["role"] == "system"
    assert len(trimmed) == 2
    assert trimmed[-1]["role"] == "user"


def test_context_trim_session_allows_component_overrides() -> None:
    module = _reload_context_trimmer(fake_tiktoken=None)
    messages = _messages()
    class StubCounter:
        def count_message(self, message: Dict[str, Any]) -> int:
            assert "content" in message
            return 7

        def meta(self) -> Dict[str, Any]:
            return {"strategy": "stub"}

    counter = StubCounter()
    measurement_calls: List[Sequence[Dict[str, Any]]] = []
    selector_calls: List[Sequence[int]] = []
    semantic_calls: List[tuple[Sequence[Dict[str, Any]], Sequence[Dict[str, Any]]]] = []
    def measurement(_: StubCounter, payload: Sequence[Dict[str, Any]]) -> Any:
        measurement_calls.append(tuple(payload))
        tokens = tuple(3 for _ in payload)
        return module.TokenCounterResult(per_message_tokens=tokens, total_tokens=3 * len(payload))

    def selector(payload: Sequence[Dict[str, Any]], per_message_tokens: Sequence[int], *, max_tokens: int) -> List[Dict[str, Any]]:
        selector_calls.append(tuple(per_message_tokens))
        assert max_tokens == 9
        return [dict(payload[0]), dict(payload[-1])]

    def semantics(
        original_messages: Sequence[Dict[str, Any]],
        trimmed_messages: Sequence[Dict[str, Any]],
        semantic_options: Mapping[str, Any] | None,
    ) -> tuple[Dict[str, Any], float | None]:
        semantic_calls.append((tuple(original_messages), tuple(trimmed_messages)))
        assert semantic_options == {"flag": True}
        return {"flag": True}, 0.5

    strategy = module.ContextTrimStrategy(lambda _: counter, measurement, lambda payload, per_tokens, budget: selector(payload, per_tokens, max_tokens=budget), semantics)
    result = module.ContextTrimSession(
        messages,
        model="stub-model",
        max_context_tokens=9,
        semantic_options={"flag": True},
        strategy=strategy,
    ).run().as_mapping()

    assert len(measurement_calls) == 2
    assert selector_calls == [tuple(3 for _ in messages)]
    assert len(semantic_calls) == 1
    assert [m["content"] for m in result["messages"]] == [messages[0]["content"], messages[-1]["content"]]
    assert result["token_counter"] == {"strategy": "stub"}
    assert result["statistics"]["input_tokens"] == 3 * len(messages)
    assert result["statistics"]["output_tokens"] == 6
    assert result["statistics"]["semantic_retention"] == pytest.approx(0.5)


def test_context_trim_session_matches_trim_messages_result() -> None:
    module = _reload_context_trimmer(fake_tiktoken=None)
    messages = _messages()
    session = module.ContextTrimSession(messages, model="test-model", max_context_tokens=100)
    assert session.run().as_mapping() == module.trim_messages(messages, max_context_tokens=100, model="test-model")


def test_compute_semantic_metrics_propagates_retention() -> None:
    module = _reload_context_trimmer(fake_tiktoken=None)

    def embedder(text: str) -> Sequence[float]:
        return [float(len(text)) or 1.0]

    original = _messages()
    trimmed = original[:-1]
    options, retention = module.compute_semantic_metrics(
        original,
        trimmed,
        {"embedder": embedder},
    )

    assert options["embedder"] is embedder
    assert 0.0 <= (retention or 0.0) <= 1.0
