from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Mapping, Sequence, TypedDict


class Node(TypedDict):
    id: str; intent_scores: Mapping[str, float]; ppr: float; category: str


class PackConfig(TypedDict, total=False):
    intent_weight: float; ppr_weight: float; limit: int; diversity_penalty: float


DEFAULT_CONFIG: PackConfig = {"intent_weight": 0.7, "ppr_weight": 0.3, "limit": 5, "diversity_penalty": 0.2}


@dataclass(frozen=True)
class IntentSignals:
    graph: Sequence[Node]; intent: str; intent_weight: float; ppr_weight: float

    def build(self) -> Dict[str, float]:
        return {
            node["id"]: node["intent_scores"].get(self.intent, 0.0) * self.intent_weight + node["ppr"] * self.ppr_weight
            for node in self.graph
        }


@dataclass(frozen=True)
class CandidateSelector:
    graph: Sequence[Node]; signals: Mapping[str, float]; limit: int; diversity_penalty: float

    def ranked_candidates(self) -> Sequence[Node]:
        return sorted(self.graph, key=lambda node: self.signals.get(node["id"], 0.0), reverse=True)[: self.limit]

    def select_with_metrics(self) -> tuple[Sequence[Node], Dict[str, object]]:
        ranked = list(self.ranked_candidates())
        if not ranked:
            return [], {"mean_score": 0.0, "category_counts": {}}
        counts: Dict[str, int] = {}; adjusted = []
        for node in ranked:
            category = node["category"]
            penalty = counts.get(category, 0) * self.diversity_penalty
            adjusted.append((self.signals.get(node["id"], 0.0) - penalty, node))
            counts[category] = counts.get(category, 0) + 1
        adjusted.sort(key=lambda entry: entry[0], reverse=True)
        selected = [node for _, node in adjusted[: self.limit]]
        categories: Dict[str, int] = {}; scores = []
        for node in selected:
            categories[node["category"]] = categories.get(node["category"], 0) + 1; scores.append(self.signals.get(node["id"], 0.0))
        mean = sum(scores) / len(scores) if scores else 0.0
        return selected, {"mean_score": mean, "category_counts": categories}


def pack_graph(graph: Sequence[Node], intent: str, config: PackConfig | None = None) -> Dict[str, object]:
    merged: Dict[str, float | int] = dict(DEFAULT_CONFIG)
    if config:
        merged.update(config)
    signals = IntentSignals(
        graph,
        intent=intent,
        intent_weight=float(merged["intent_weight"]),
        ppr_weight=float(merged["ppr_weight"]),
    ).build()
    selector = CandidateSelector(
        graph,
        signals,
        limit=int(merged["limit"]),
        diversity_penalty=float(merged["diversity_penalty"]),
    )
    diversified, metrics = selector.select_with_metrics()
    ranked = selector.ranked_candidates()
    return {
        "intent": intent,
        "signals": signals,
        "ranked_ids": [node["id"] for node in ranked],
        "diverse_ids": [node["id"] for node in diversified],
        "metrics": metrics,
    }
