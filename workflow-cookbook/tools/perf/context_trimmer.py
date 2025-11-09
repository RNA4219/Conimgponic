# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 RNA4219

"""Context trimming utilities for workflow messages."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from itertools import zip_longest
from math import isclose, sqrt
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Protocol

_Message = Mapping[str, Any]
_MutableMessage = MutableMapping[str, Any]


class TokenCounterProtocol(Protocol):
    def count_message(self, message: _Message) -> int: ...
    def meta(self) -> Dict[str, Any]: ...


@dataclass(frozen=True)
class TokenCounterResult:
    """Aggregate token counts for a collection of messages."""

    per_message_tokens: tuple[int, ...]
    total_tokens: int

    @classmethod
    def from_messages(
        cls,
        counter: TokenCounterProtocol,
        messages: Sequence[_Message],
    ) -> "TokenCounterResult":
        """Measure tokens for the provided messages."""

        tokens = tuple(counter.count_message(message) for message in messages)
        return cls(per_message_tokens=tokens, total_tokens=sum(tokens))


@dataclass(frozen=True)
class TrimOutcome:
    """Package the legacy trim result mapping."""

    messages: list[_MutableMessage]
    statistics: Dict[str, Any]
    token_counter: Dict[str, Any]
    semantic_options: Dict[str, Any]

    def as_mapping(self) -> Dict[str, Any]:
        """Expose the historical mapping structure."""

        return {
            "messages": self.messages,
            "statistics": self.statistics,
            "token_counter": self.token_counter,
            "semantic_options": self.semantic_options,
        }


class _TokenCounter:
    """Resolve token counting using tiktoken when available."""

    _MODEL_ALIASES = {
        "gpt-4o": "gpt-4o",
        "gpt-4o-mini": "gpt-4o-mini",
        "gpt-4": "gpt-4",
        "gpt-3.5-turbo": "gpt-3.5-turbo",
    }

    def __init__(self, model: str) -> None:
        self.model = model
        self._encoder = None
        self._encoding_name: str | None = None
        self._uses_tiktoken = False
        self._load_encoder()

    def _load_encoder(self) -> None:
        resolved = self._MODEL_ALIASES.get(self.model, self.model)
        try:
            import tiktoken  # type: ignore
        except ModuleNotFoundError:
            return
        except Exception:
            return
        try:
            self._encoder = tiktoken.encoding_for_model(resolved)
        except Exception:
            try:
                self._encoder = tiktoken.get_encoding("cl100k_base")
            except Exception:
                self._encoder = None
        if self._encoder is not None:
            self._encoding_name = getattr(self._encoder, "name", None)
            self._uses_tiktoken = True

    def count_message(self, message: _Message) -> int:
        content = str(message.get("content", ""))
        base_tokens = 4
        if self._encoder is not None:
            tokens = len(self._encoder.encode(content))
        else:
            tokens = max(1, len(content) // 4 + 1)
        return base_tokens + tokens

    def meta(self) -> Dict[str, Any]:
        strategy = "tiktoken" if self._encoder is not None else "heuristic"
        return {
            "model": self.model,
            "encoding": self._encoding_name,
            "uses_tiktoken": self._uses_tiktoken,
            "strategy": strategy,
        }


def _normalise_messages(messages: Sequence[_Message]) -> List[_MutableMessage]:
    return [dict(message) for message in messages]


def _to_vector(values: Sequence[float]) -> List[float]:
    return [float(value) for value in values]


_FLOAT_ZERO_ABS_TOL = 1e-12


def _is_effectively_zero(value: float) -> bool:
    return isclose(value, 0.0, abs_tol=_FLOAT_ZERO_ABS_TOL)


def _cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    vec_a = _to_vector(a)
    vec_b = _to_vector(b)
    dot_product = sum(x * y for x, y in zip_longest(vec_a, vec_b, fillvalue=0.0))
    norm_a = sqrt(sum(x * x for x in vec_a))
    norm_b = sqrt(sum(y * y for y in vec_b))
    if _is_effectively_zero(norm_a) and _is_effectively_zero(norm_b):
        return 0.0
    if _is_effectively_zero(norm_a) or _is_effectively_zero(norm_b):
        return 0.0
    similarity = dot_product / (norm_a * norm_b)
    if similarity < 0.0:
        return 0.0
    if similarity > 1.0:
        return 1.0
    return similarity


def _messages_to_text(messages: Iterable[_Message]) -> str:
    return "\n".join(str(message.get("content", "")) for message in messages)


def _compute_semantic_retention(
    original_text: str,
    trimmed_text: str,
    embedder: Callable[[str], Sequence[float]],
) -> float:
    original_vector = _to_vector(embedder(original_text))
    trimmed_vector = _to_vector(embedder(trimmed_text))
    return _cosine_similarity(original_vector, trimmed_vector)


def compute_semantic_metrics(
    original_messages: Sequence[_Message],
    trimmed_messages: Sequence[_Message],
    semantic_options: Mapping[str, Any] | None,
) -> tuple[Dict[str, Any], float | None]:
    """Evaluate semantic retention using the provided options."""

    if semantic_options is None:
        return {}, None

    used_options = dict(semantic_options)
    embedder = used_options.get("embedder")
    if not callable(embedder):
        return used_options, None

    try:
        retention = _compute_semantic_retention(
            _messages_to_text(original_messages),
            _messages_to_text(trimmed_messages),
            embedder,
        )
    except Exception:
        retention = 0.0
    return used_options, retention


def build_statistics(
    input_tokens: int,
    output_tokens: int,
    semantic_retention: float | None,
) -> Dict[str, Any]:
    """Compose statistics with backwards compatible keys."""

    compress_ratio = 1.0 if input_tokens == 0 else output_tokens / input_tokens
    statistics: Dict[str, Any] = {
        "compress_ratio": compress_ratio,
        "compression_ratio": compress_ratio,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
    }
    if semantic_retention is not None:
        statistics["semantic_retention"] = semantic_retention
    return statistics


def select_messages(
    messages: Sequence[_MutableMessage],
    per_message_tokens: Sequence[int],
    *,
    max_tokens: int,
) -> List[_MutableMessage]:
    """Choose messages that fit within the token budget."""

    if len(messages) != len(per_message_tokens):
        raise ValueError("messages and per_message_tokens must align")

    paired = list(zip(messages, per_message_tokens))
    system_pair: tuple[_MutableMessage, int] | None = None
    remainder_pairs: List[tuple[_MutableMessage, int]] = []
    for message, tokens in paired:
        if message.get("role") == "system" and system_pair is None:
            system_pair = (message, tokens)
        else:
            remainder_pairs.append((message, tokens))

    trimmed: List[_MutableMessage] = []
    running_tokens = 0
    if system_pair is not None:
        trimmed.append(system_pair[0])
        running_tokens += system_pair[1]

    kept: List[tuple[_MutableMessage, int]] = []
    for message, tokens in reversed(remainder_pairs):
        if running_tokens + tokens <= max_tokens or not kept:
            kept.append((message, tokens))
            running_tokens += tokens
    kept.reverse()
    trimmed.extend(message for message, _ in kept)
    return trimmed


@dataclass(frozen=True)
class ContextTrimStrategy:
    token_counter_factory: Callable[[str], TokenCounterProtocol]
    token_measurement: Callable[[TokenCounterProtocol, Sequence[_Message]], TokenCounterResult]
    message_selector: Callable[[Sequence[_MutableMessage], Sequence[int], int], List[_MutableMessage]]
    semantic_metrics: Callable[[Sequence[_Message], Sequence[_Message], Mapping[str, Any] | None], tuple[Dict[str, Any], float | None]]

    @classmethod
    def default(cls) -> "ContextTrimStrategy":
        return cls(
            _TokenCounter,
            TokenCounterResult.from_messages,
            lambda messages, per_tokens, budget: select_messages(messages, per_tokens, max_tokens=budget),
            compute_semantic_metrics,
        )


class ContextTrimSession:
    def __init__(
        self,
        messages: Sequence[_Message],
        *,
        max_context_tokens: int,
        model: str,
        token_counter: TokenCounterProtocol | None = None,
        semantic_options: Mapping[str, Any] | None = None,
        strategy: ContextTrimStrategy | None = None,
    ) -> None:
        self._messages = messages
        self._max_context_tokens = max_context_tokens
        self._model = model
        self._token_counter: TokenCounterProtocol | None = token_counter
        self._semantic_options = semantic_options
        self._strategy = strategy or ContextTrimStrategy.default()

    def run(self) -> TrimOutcome:
        counter = self._token_counter or self._strategy.token_counter_factory(self._model)
        self._token_counter = counter
        mutable = _normalise_messages(self._messages)
        input_tokens = self._strategy.token_measurement(counter, mutable)
        trimmed = self._strategy.message_selector(mutable, input_tokens.per_message_tokens, self._max_context_tokens)
        output_tokens = self._strategy.token_measurement(counter, trimmed)
        used_options, retention = self._strategy.semantic_metrics(mutable, trimmed, self._semantic_options)
        statistics = build_statistics(input_tokens.total_tokens, output_tokens.total_tokens, retention)
        return TrimOutcome(messages=trimmed, statistics=statistics, token_counter=counter.meta(), semantic_options=used_options)


def trim_messages(
    messages: Sequence[_Message],
    *,
    max_context_tokens: int,
    model: str,
    token_counter: _TokenCounter | None = None,
    semantic_options: Mapping[str, Any] | None = None,
) -> Mapping[str, Any]:
    """Trim messages to satisfy a maximum context token budget."""

    session = ContextTrimSession(
        messages,
        max_context_tokens=max_context_tokens,
        model=model,
        token_counter=token_counter,
        semantic_options=semantic_options,
    )
    return session.run().as_mapping()
