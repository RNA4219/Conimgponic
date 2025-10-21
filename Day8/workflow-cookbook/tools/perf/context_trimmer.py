# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 RNA4219

"""Context trimming utilities for workflow messages."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Sequence

_Message = Mapping[str, Any]
_MutableMessage = MutableMapping[str, Any]


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


def _first_system_message(messages: Iterable[_MutableMessage]) -> tuple[_MutableMessage | None, List[_MutableMessage]]:
    system_message: _MutableMessage | None = None
    remainder: List[_MutableMessage] = []
    for message in messages:
        if message.get("role") == "system" and system_message is None:
            system_message = message
        else:
            remainder.append(message)
    return system_message, remainder


def trim_messages(
    messages: Sequence[_Message],
    *,
    max_context_tokens: int,
    model: str,
    token_counter: _TokenCounter | None = None,
    semantic_options: Mapping[str, Any] | None = None,
) -> Mapping[str, Any]:
    """Trim messages to satisfy a maximum context token budget."""

    counter = token_counter or _TokenCounter(model)
    mutable_messages = _normalise_messages(messages)
    system_message, remainder = _first_system_message(mutable_messages)
    total_input_tokens = sum(counter.count_message(message) for message in mutable_messages)

    trimmed: List[_MutableMessage] = []
    running_tokens = 0
    if system_message is not None:
        trimmed.append(system_message)
        running_tokens += counter.count_message(system_message)

    kept: List[_MutableMessage] = []
    for message in reversed(remainder):
        tokens = counter.count_message(message)
        if running_tokens + tokens <= max_context_tokens or not kept:
            kept.append(message)
            running_tokens += tokens
    kept.reverse()
    trimmed.extend(kept)

    output_tokens = sum(counter.count_message(message) for message in trimmed)
    compression_ratio = 1.0 if total_input_tokens == 0 else output_tokens / total_input_tokens

    return {
        "messages": trimmed,
        "statistics": {
            "compression_ratio": compression_ratio,
            "input_tokens": total_input_tokens,
            "output_tokens": output_tokens,
        },
        "token_counter": counter.meta(),
        "semantic_options": dict(semantic_options or {}),
    }
