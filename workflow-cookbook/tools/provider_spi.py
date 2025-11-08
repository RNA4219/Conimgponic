# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 RNA4219

from __future__ import annotations

from typing import Any, AsyncIterator, Protocol, runtime_checkable

__all__ = ["LLMProvider", "ensure_autosave_rollout_enabled"]


@runtime_checkable
class LLMProvider(Protocol):
    """SPI that large-language-model providers must satisfy.

    Implementations should raise ``TimeoutError`` or ``asyncio.TimeoutError``
    when a request exceeds the configured deadline, and reuse standard
    exceptions such as ``ValueError`` for invalid inputs. Provider-specific
    failures should derive from ``RuntimeError`` so that callers can decide
    whether a retry is appropriate.
    """

    async def stream(self, prompt: str, /, **kwargs: Any) -> AsyncIterator[str]:
        """Return an async iterator that yields response chunks for *prompt*."""

    async def complete(self, prompt: str, /, **kwargs: Any) -> str:
        """Return the fully concatenated response for *prompt*."""


def ensure_autosave_rollout_enabled(*, flag_enabled: bool, checklist_completed: bool) -> bool:
    """Guard staged rollout flags per docs/IMPLEMENTATION-PLAN.md flag policy."""

    if not flag_enabled:
        return False
    if not checklist_completed:
        raise RuntimeError(
            "autosave.project_lock requires checklist completion before enabling"
        )
    return True
