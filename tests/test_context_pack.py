from __future__ import annotations

from pathlib import Path
import sys
from typing import Dict

import pytest

sys.path.append(str(Path(__file__).resolve().parents[1]))

from tools.context.pack import CandidateSelector, IntentSignals, DEFAULT_CONFIG, pack_graph

GRAPH = [
    {"id": "doc-1", "intent_scores": {"search": 0.9, "summarize": 0.2}, "ppr": 0.6, "category": "docs"},
    {"id": "doc-2", "intent_scores": {"search": 0.8, "summarize": 0.1}, "ppr": 0.5, "category": "docs"},
    {"id": "note-1", "intent_scores": {"search": 0.3, "summarize": 0.9}, "ppr": 0.4, "category": "notes"},
]


@pytest.fixture(scope="module")
def search_signals() -> Dict[str, float]:
    return IntentSignals(
        GRAPH,
        intent="search",
        intent_weight=DEFAULT_CONFIG["intent_weight"],
        ppr_weight=DEFAULT_CONFIG["ppr_weight"],
    ).build()


def test_intent_signals_compute_expected_scores(search_signals: Dict[str, float]) -> None:
    expected = {"doc-1": pytest.approx(0.81), "doc-2": pytest.approx(0.71), "note-1": pytest.approx(0.33)}
    for node_id, score in expected.items():
        assert search_signals[node_id] == score


def test_candidate_selector_prefers_highest_scores(search_signals: Dict[str, float]) -> None:
    selector = CandidateSelector(GRAPH, search_signals, limit=2, diversity_penalty=DEFAULT_CONFIG["diversity_penalty"])
    assert [candidate["id"] for candidate in selector.ranked_candidates()] == ["doc-1", "doc-2"]


def test_pack_graph_applies_diversity_penalty(search_signals: Dict[str, float]) -> None:
    selector = CandidateSelector(GRAPH, search_signals, limit=3, diversity_penalty=0.5)
    diversified, metrics = selector.select_with_metrics()
    assert [candidate["id"] for candidate in diversified] == ["doc-1", "note-1", "doc-2"]
    assert metrics == {"category_counts": {"docs": 2, "notes": 1}, "mean_score": pytest.approx((0.81 + 0.33 + 0.71) / 3)}

    result = pack_graph(GRAPH, intent="search", config={"diversity_penalty": 0.5, "limit": 3})
    assert result == {
        "intent": "search",
        "signals": search_signals,
        "ranked_ids": ["doc-1", "doc-2", "note-1"],
        "diverse_ids": ["doc-1", "note-1", "doc-2"],
        "metrics": metrics,
    }
