from __future__ import annotations

import argparse
import json
import math
from collections import Counter, deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import (
    Callable,
    Dict,
    Iterable,
    List,
    Mapping,
    MutableMapping,
    Sequence,
    TypedDict,
    cast,
)

class GraphNode(TypedDict, total=False):
    id: str
    path: str
    heading: str
    depth: int
    mtime: str
    token_estimate: int
    role: str


class GraphEdge(TypedDict, total=False):
    src: str
    dst: str
    type: str


ConfigDict = Dict[str, object]


class SectionWhy(TypedDict):
    intent: float
    diff: float
    recency: float
    hub: float
    role: float
    ppr: float
    score: float


class SectionEntry(TypedDict):
    id: str
    tok: int
    filters: List[str]
    why: SectionWhy


class PackMetrics(TypedDict):
    token_in: int
    token_src: int
    dup_rate: float
    ppr_entropy: float
    diversity_penalty: float


class PackOutput(TypedDict):
    intent: str
    budget: str
    sections: List[SectionEntry]
    metrics: PackMetrics


DEFAULT_CONFIG: ConfigDict = {
    "pagerank": {"lambda": 0.85, "theta": 0.6},
    "weights": {"intent": 0.40, "diff": 0.25, "recency": 0.20, "hub": 0.10, "role": 0.05},
    "recency_halflife_days": 45,
    "diversity": {"mu_file": 0.15, "mu_role": 0.10},
    "limits": {"ncand": 2000, "iters": 50, "tol": 1e-6},
}


@dataclass(frozen=True)
class IntentProfile:
    keywords: list[str]
    role: str | None
    halflife: int


@dataclass(frozen=True)
class BaseSignals:
    intent: float
    diff: float
    recency: float
    hub: float
    role: float


@dataclass
class GraphView:
    nodes: Sequence[GraphNode]
    edges: Sequence[GraphEdge]
    intent_profile: IntentProfile
    adjacency: Dict[str, List[str]]
    reverse_adjacency: Dict[str, List[str]]
    base_signals: Dict[str, BaseSignals]
    base_scores: Dict[str, float]
    hits: List[str]


class GraphViewBuilder:
    def __init__(
        self,
        *,
        graph: Mapping[str, object],
        intent: str,
        diff_paths: Sequence[str],
        config: Mapping[str, object],
    ) -> None:
        self._graph = graph
        self._intent = intent
        self._diff_paths = [str(path) for path in diff_paths]
        self._config = _as_mapping(config)

    def normalize_nodes(self) -> List[GraphNode]:
        nodes_raw = self._graph.get("nodes", [])
        if not isinstance(nodes_raw, list):
            return []
        return [cast(GraphNode, node) for node in nodes_raw]

    def normalize_edges(self) -> List[GraphEdge]:
        edges_raw = self._graph.get("edges", [])
        if not isinstance(edges_raw, list):
            return []
        return [cast(GraphEdge, edge) for edge in edges_raw]

    def build_intent_profile(self) -> IntentProfile:
        halflife = _config_int(self._config, "recency_halflife_days", 45)
        raw_intent = _intent_profile(self._intent, halflife)
        keywords_value = raw_intent.get("keywords", [])
        keywords = (
            [str(item) for item in keywords_value]
            if isinstance(keywords_value, list)
            else []
        )
        role_value = raw_intent.get("role")
        role = role_value if isinstance(role_value, str) else None
        return IntentProfile(keywords=keywords, role=role, halflife=halflife)

    def build_adjacency(
        self, edges: Sequence[GraphEdge]
    ) -> tuple[Dict[str, List[str]], Dict[str, List[str]]]:
        adjacency: Dict[str, List[str]] = {}
        reverse_adj: Dict[str, List[str]] = {}
        for edge in edges:
            src = edge.get("src")
            dst = edge.get("dst")
            if isinstance(src, str) and isinstance(dst, str):
                adjacency.setdefault(src, []).append(dst)
                reverse_adj.setdefault(dst, []).append(src)
        return adjacency, reverse_adj

    def compute_base_signals(
        self,
        nodes: Sequence[GraphNode],
        edges: Sequence[GraphEdge],
        intent_profile: IntentProfile,
    ) -> tuple[Dict[str, BaseSignals], Dict[str, float], List[str]]:
        hub_scores = _hub_scores(nodes, edges)
        weights_map = _as_mapping(self._config.get("weights"))
        weight_intent = _config_float(weights_map, "intent", 0.0)
        weight_diff = _config_float(weights_map, "diff", 0.0)
        weight_recency = _config_float(weights_map, "recency", 0.0)
        weight_hub = _config_float(weights_map, "hub", 0.0)
        weight_role = _config_float(weights_map, "role", 0.0)
        base_signals: Dict[str, BaseSignals] = {}
        base_scores: Dict[str, float] = {}
        hits: List[str] = []
        for node in nodes:
            node_id = node.get("id")
            if not isinstance(node_id, str):
                continue
            heading = node.get("heading") or ""
            path = node.get("path") or ""
            tokens = _token_set(str(heading), str(path))
            intent_hit = _intent_hit(intent_profile.keywords, tokens)
            diff_hit = _diff_hit(str(path), self._diff_paths)
            mtime_value = node.get("mtime")
            mtime = (
                mtime_value
                if isinstance(mtime_value, str)
                else datetime.now(timezone.utc).isoformat()
            )
            recency = _recency_score(mtime, intent_profile.halflife)
            hub = hub_scores.get(node_id, 0.0)
            role_value_node = node.get("role")
            role_score = _role_weight(
                role_value_node if isinstance(role_value_node, str) else None,
                intent_profile.role,
            )
            signals = BaseSignals(intent_hit, diff_hit, recency, hub, role_score)
            base_signals[node_id] = signals
            if intent_hit > 0 or diff_hit > 0:
                hits.append(node_id)
            base_scores[node_id] = (
                signals.intent * weight_intent
                + signals.diff * weight_diff
                + signals.recency * weight_recency
                + signals.hub * weight_hub
                + signals.role * weight_role
            )
        return base_signals, base_scores, hits

    def build(self) -> GraphView:
        nodes = self.normalize_nodes()
        edges = self.normalize_edges()
        intent_profile = self.build_intent_profile()
        adjacency, reverse_adj = self.build_adjacency(edges)
        base_signals, base_scores, hits = self.compute_base_signals(
            nodes, edges, intent_profile
        )
        return GraphView(
            nodes=nodes,
            edges=edges,
            intent_profile=intent_profile,
            adjacency=adjacency,
            reverse_adjacency=reverse_adj,
            base_signals=base_signals,
            base_scores=base_scores,
            hits=hits,
        )


@dataclass
class CandidateRanking:
    candidate_nodes: List[GraphNode]
    ppr_scores: Dict[str, float]
    scores: Dict[str, float]
    ranked_nodes: List[GraphNode]


@dataclass
class CandidateSelector:
    view: GraphView
    config: Mapping[str, object]

    def select(self) -> List[GraphNode]:
        candidate_ids = self._collect_candidate_ids()
        sorted_candidates = sorted(
            candidate_ids,
            key=lambda node_id: self.view.base_scores.get(node_id, 0.0),
            reverse=True,
        )
        limits = _as_mapping(self.config.get("limits"))
        ncand = _config_int(limits, "ncand", 2000)
        selected_ids = set(sorted_candidates[:ncand])
        candidate_nodes = self._filter_nodes(selected_ids if selected_ids else None)
        if not candidate_nodes:
            candidate_nodes = self._filter_nodes(None)
        return candidate_nodes

    def _collect_candidate_ids(self) -> set[str]:
        if self.view.hits:
            return _candidate_ids(
                self.view.hits,
                self.view.adjacency,
                self.view.reverse_adjacency,
                2,
            )
        return set(self.view.base_scores.keys())

    def _filter_nodes(self, allowed: set[str] | None) -> List[GraphNode]:
        result: List[GraphNode] = []
        for node in self.view.nodes:
            node_id = node.get("id")
            if not isinstance(node_id, str):
                continue
            if allowed is None or node_id in allowed:
                result.append(node)
        return result


@dataclass
class PPRRanker:
    view: GraphView
    config: Mapping[str, object]
    candidate_nodes: Sequence[GraphNode]

    def rank(self) -> CandidateRanking:
        candidates = list(self.candidate_nodes)
        pagerank_cfg = _as_mapping(self.config.get("pagerank"))
        limits = _as_mapping(self.config.get("limits"))
        ppr_scores = personalize_scores(
            candidates,
            self.view.edges,
            self.view.base_scores,
            _config_float(pagerank_cfg, "lambda", 0.85),
            _config_int(limits, "iters", 50),
            _config_float(limits, "tol", 1e-6),
        )
        theta = _config_float(pagerank_cfg, "theta", 0.6)
        scores: Dict[str, float] = {}
        for node in candidates:
            node_id = node.get("id")
            if not isinstance(node_id, str):
                continue
            base_score = self.view.base_scores.get(node_id, 0.0)
            ppr_score = ppr_scores.get(node_id, 0.0)
            scores[node_id] = theta * ppr_score + (1 - theta) * base_score

        def node_score(node: GraphNode) -> float:
            node_id = node.get("id")
            if isinstance(node_id, str):
                return scores.get(node_id, 0.0)
            return 0.0

        ranked_nodes = sorted(candidates, key=node_score, reverse=True)
        if not ranked_nodes:
            ranked_nodes = candidates
        return CandidateRanking(
            candidate_nodes=candidates,
            ppr_scores=ppr_scores,
            scores=scores,
            ranked_nodes=ranked_nodes,
        )


@dataclass(frozen=True)
class SectionSelection:
    sections: List[SectionEntry]
    token_in: int
    penalties: List[float]


class SectionSelector:
    def __init__(
        self,
        *,
        view: GraphView,
        ranking: CandidateRanking,
        budget_tokens: int,
        config: Mapping[str, object],
    ) -> None:
        self._view = view
        self._ranking = ranking
        self._budget_tokens = budget_tokens
        diversity_cfg = _as_mapping(config.get("diversity"))
        self._mu_file = _config_float(diversity_cfg, "mu_file", 0.15)
        self._mu_role = _config_float(diversity_cfg, "mu_role", 0.10)
        self._path_counter: Counter[str] = Counter()
        self._role_counter: Counter[str] = Counter()

    def select(self) -> SectionSelection:
        sections: List[SectionEntry] = []
        penalties: List[float] = []
        token_in = 0
        for node in self._ranking.ranked_nodes:
            node_id = node.get("id")
            if not isinstance(node_id, str):
                continue
            tokens = _token_budget(node)
            if token_in + tokens > self._budget_tokens:
                continue
            path_value = node.get("path")
            path_str = path_value if isinstance(path_value, str) else ""
            role_value = node.get("role")
            role_str = role_value if isinstance(role_value, str) else None
            penalty = _diversity_penalty(
                path_str,
                role_str,
                self._path_counter,
                self._role_counter,
                len(sections),
                self._mu_file,
                self._mu_role,
            )
            penalties.append(penalty)
            signals = self._view.base_signals[node_id]
            adjusted = self._ranking.scores.get(node_id, 0.0) * penalty
            section: SectionEntry = {
                "id": node_id,
                "tok": tokens,
                "filters": ["lossless", "pointer", "role_extract"],
                "why": {
                    "intent": signals.intent,
                    "diff": signals.diff,
                    "recency": signals.recency,
                    "hub": signals.hub,
                    "role": signals.role,
                    "ppr": self._ranking.ppr_scores.get(node_id, 0.0),
                    "score": adjusted,
                },
            }
            sections.append(section)
            token_in += tokens
            self._path_counter[path_str] += 1
            self._role_counter[role_str or "unknown"] += 1
        return SectionSelection(sections=sections, token_in=token_in, penalties=penalties)


class PackMetricsBuilder:
    def __init__(self, *, ranking: CandidateRanking, selection: SectionSelection) -> None:
        self._ranking = ranking
        self._selection = selection

    def build(self) -> PackMetrics:
        token_src = sum(_token_budget(node) for node in self._ranking.ranked_nodes)
        penalty_terms = [1 - value for value in self._selection.penalties]
        count = len(self._selection.penalties)
        diversity_penalty = sum(penalty_terms) / count if count else 0.0
        sections = self._selection.sections
        dup_rate = 0.0
        if sections:
            unique_paths = {str(section["id"]).split("#", 1)[0] for section in sections}
            dup_rate = 1.0 - len(unique_paths) / len(sections)
        ppr_values: List[float] = []
        for node in self._ranking.candidate_nodes:
            node_id = node.get("id")
            if isinstance(node_id, str):
                ppr_values.append(self._ranking.ppr_scores.get(node_id, 0.0))
        normaliser = sum(ppr_values) or 1.0
        entropy = -sum(
            (value / normaliser) * math.log(value / normaliser)
            for value in ppr_values
            if value > 0
        )
        return {
            "token_in": self._selection.token_in,
            "token_src": token_src,
            "dup_rate": dup_rate,
            "ppr_entropy": entropy,
            "diversity_penalty": diversity_penalty,
        }


@dataclass
class AssemblyResult:
    sections: List[SectionEntry]
    metrics: PackMetrics


@dataclass(frozen=True)
class ContextPackPlan:
    intent: str
    budget_tokens: int
    diff_paths: Sequence[str]
    graph: Mapping[str, object]
    config: Mapping[str, object]
    view: GraphView
    ranking: CandidateRanking
    assembly: AssemblyResult

    @property
    def target_candidates(self) -> List[str]:
        candidates: List[str] = []
        for node in self.ranking.ranked_nodes:
            node_id = node.get("id")
            if isinstance(node_id, str):
                candidates.append(node_id)
        return candidates

    @property
    def budget_remaining(self) -> int:
        consumed = int(self.assembly.metrics["token_in"])
        remaining = self.budget_tokens - consumed
        return remaining if remaining >= 0 else 0


class ContextPackPlanner:
    def __init__(
        self,
        *,
        config_loader: Callable[[Path | None], Mapping[str, object]] | None = None,
    ) -> None:
        self._config_loader = config_loader or load_config
        self.config: Mapping[str, object] | None = None
        self.graph: Mapping[str, object] | None = None
        self.view: GraphView | None = None
        self.ranking: CandidateRanking | None = None
        self.assembly: AssemblyResult | None = None

    def build_plan(
        self,
        *,
        graph_path: Path,
        intent: str,
        budget_tokens: int,
        diff_paths: Sequence[str],
        config: Mapping[str, object] | None = None,
    ) -> ContextPackPlan:
        config_map = config if config is not None else self._config_loader(None)
        graph = json.loads(graph_path.read_text())
        view = build_graph_view(graph, intent, diff_paths, config_map)
        ranking = score_candidates(view, config_map)
        assembly = assemble_sections(view, ranking, budget_tokens, config_map)
        self.config = config_map
        self.graph = graph
        self.view = view
        self.ranking = ranking
        self.assembly = assembly
        return ContextPackPlan(
            intent=intent,
            budget_tokens=budget_tokens,
            diff_paths=tuple(diff_paths),
            graph=graph,
            config=config_map,
            view=view,
            ranking=ranking,
            assembly=assembly,
        )


class ContextPackExecutor:
    def __init__(self, plan: ContextPackPlan) -> None:
        self.plan = plan
        self.output: PackOutput | None = None

    def pack(self) -> PackOutput:
        result: PackOutput = {
            "intent": self.plan.intent,
            "budget": str(self.plan.budget_tokens),
            "sections": self.plan.assembly.sections,
            "metrics": self.plan.assembly.metrics,
        }
        self.output = result
        return result


def load_config(path: Path | None = None) -> ConfigDict:
    target = path or Path("tools/context/config.yaml")
    if not target.exists():
        return json.loads(json.dumps(DEFAULT_CONFIG))
    return _parse_simple_yaml(target.read_text())


def _parse_simple_yaml(text: str) -> ConfigDict:
    root: Dict[str, object] = {}
    stack: List[tuple[int, MutableMapping[str, object]]] = [(0, root)]
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        while stack and indent < stack[-1][0]:
            stack.pop()
        parent = stack[-1][1]
        key, _, rest = line.partition(":")
        key = key.strip()
        value = rest.strip()
        if not value:
            node: MutableMapping[str, object] = {}
            parent[key] = node
            stack.append((indent + 2, node))
        else:
            parent[key] = _coerce_scalar(value)
    return root


def _coerce_scalar(value: str):
    lowered = value.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    try:
        if any(ch in value for ch in ".eE"):
            return float(value)
        return int(value)
    except ValueError:
        return value


def _token_set(*parts: str) -> set[str]:
    tokens: set[str] = set()
    for part in parts:
        for piece in part.replace("/", " ").replace("-", " ").split():
            clean = "".join(ch for ch in piece.lower() if ch.isalnum())
            if clean:
                tokens.add(clean)
    return tokens


def _intent_profile(intent: str, halflife: int) -> Dict[str, object]:
    tokens = _token_set(intent)
    role = next((r for r in ["impl", "ops", "risk", "spec"] if r in tokens), None)
    keywords = sorted(tokens - {"int", "intent"})
    return {"keywords": keywords, "role": role, "halflife": halflife}


def _recency_score(iso_ts: str, halflife: int) -> float:
    mt = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
    age = max(0.0, (datetime.now(timezone.utc) - mt).total_seconds() / 86400)
    return math.exp(-age / max(halflife, 1))


def _hub_scores(nodes: Sequence[GraphNode], edges: Sequence[GraphEdge]) -> Dict[str, float]:
    degree: Counter[str] = Counter()
    for edge in edges:
        src = edge.get("src")
        if isinstance(src, str):
            degree[src] += 1
    max_deg = max(degree.values(), default=1)
    result: Dict[str, float] = {}
    for node in nodes:
        node_id = node.get("id")
        if not isinstance(node_id, str):
            continue
        out_deg = degree.get(node_id, 0)
        result[node_id] = math.log1p(out_deg) / math.log1p(max_deg) if max_deg else 0.0
    return result


def _role_weight(node_role: str | None, intent_role: str | None) -> float:
    if not intent_role:
        return 0.4
    if node_role == intent_role:
        return 0.6
    return 0.2


def _intent_hit(keywords: Sequence[str], node_tokens: set[str]) -> float:
    if not keywords:
        return 0.0
    hits = sum(1 for kw in keywords if kw in node_tokens)
    return hits / len(keywords)


def _diff_hit(path: str, diff_paths: Sequence[str]) -> float:
    if not diff_paths:
        return 0.0
    if path in diff_paths:
        return 1.0
    directories = {d.rsplit("/", 1)[0] for d in diff_paths if "/" in d}
    if any(path.startswith(dir_path + "/") or path == dir_path for dir_path in directories):
        return 0.7
    domains = {d.split("/", 1)[0] for d in diff_paths}
    if any(path.startswith(domain) for domain in domains):
        return 0.4
    return 0.0


def personalize_scores(
    nodes: Sequence[GraphNode],
    edges: Sequence[GraphEdge],
    base_scores: Mapping[str, float],
    lam: float,
    iters: int,
    tol: float,
) -> Dict[str, float]:
    indexed_nodes: List[GraphNode] = []
    node_ids: List[str] = []
    for node in nodes:
        node_id = node.get("id")
        if isinstance(node_id, str):
            indexed_nodes.append(node)
            node_ids.append(node_id)
    n = len(indexed_nodes)
    if n == 0:
        return {}
    id_to_index = {node_id: idx for idx, node_id in enumerate(node_ids)}
    adjacency: List[List[int]] = [[] for _ in range(n)]
    outdeg = [0] * n
    for edge in edges:
        src = edge.get("src")
        dst = edge.get("dst")
        if not (isinstance(src, str) and isinstance(dst, str)):
            continue
        src_idx = id_to_index.get(src)
        dst_idx = id_to_index.get(dst)
        if src_idx is None or dst_idx is None:
            continue
        adjacency[src_idx].append(dst_idx)
        outdeg[src_idx] += 1
    teleport = [max(base_scores.get(node_ids[i], 0.0), 0.0) for i in range(n)]
    total = sum(teleport) or 1.0
    teleport = [value / total for value in teleport]
    state = [1.0 / n] * n
    for _ in range(iters):
        updated = [(1 - lam) * teleport[i] for i in range(n)]
        for i, row in enumerate(adjacency):
            share = lam * state[i] / (outdeg[i] or n)
            if outdeg[i] == 0:
                for j in range(n):
                    updated[j] += share
            else:
                for j in row:
                    updated[j] += share
        delta = sum(abs(updated[i] - state[i]) for i in range(n))
        state = updated
        if delta < tol:
            break
    normaliser = sum(state) or 1.0
    return {node_ids[i]: state[i] / normaliser for i in range(n)}


def _candidate_ids(
    hits: Iterable[str],
    adjacency: Dict[str, List[str]],
    reverse_adj: Dict[str, List[str]],
    max_hops: int,
) -> set[str]:
    seen: set[str] = set()
    queue = deque((node, 0) for node in hits)
    while queue:
        node, dist = queue.popleft()
        if node in seen or dist > max_hops:
            continue
        seen.add(node)
        for nxt in adjacency.get(node, []):
            queue.append((nxt, dist + 1))
        for nxt in reverse_adj.get(node, []):
            queue.append((nxt, dist + 1))
    return seen


def _token_budget(node: Mapping[str, object]) -> int:
    estimate = node.get("token_estimate")
    if isinstance(estimate, (int, float)):
        return int(estimate)
    heading_value = node.get("heading")
    heading = heading_value if isinstance(heading_value, str) else ""
    return max(32, len(heading.split()) * 10)


def _diversity_penalty(
    path: str,
    role: str | None,
    path_counter: Counter[str],
    role_counter: Counter[str],
    total_selected: int,
    mu_file: float,
    mu_role: float,
) -> float:
    if total_selected == 0:
        return 1.0
    file_ratio = path_counter[path] / total_selected if total_selected else 0.0
    role_ratio = role_counter[role or "unknown"] / total_selected if total_selected else 0.0
    penalty = 1.0 - (mu_file * file_ratio + mu_role * role_ratio)
    return max(0.1, penalty)


def _as_mapping(value: object) -> Mapping[str, object]:
    if isinstance(value, Mapping):
        return cast(Mapping[str, object], value)
    return {}


def _config_int(config: Mapping[str, object], key: str, default: int) -> int:
    value = config.get(key, default)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(float(value))
        except ValueError:
            return default
    return default


def _config_float(config: Mapping[str, object], key: str, default: float) -> float:
    value = config.get(key, default)
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return default
    return default


def build_graph_view(
    graph: Mapping[str, object],
    intent: str,
    diff_paths: Sequence[str],
    config: Mapping[str, object],
) -> GraphView:
    builder = GraphViewBuilder(
        graph=graph,
        intent=intent,
        diff_paths=diff_paths,
        config=config,
    )
    return builder.build()


def score_candidates(
    view: GraphView,
    config: Mapping[str, object],
) -> CandidateRanking:
    candidate_nodes = CandidateSelector(view=view, config=config).select()
    return PPRRanker(
        view=view,
        config=config,
        candidate_nodes=candidate_nodes,
    ).rank()


def assemble_sections(
    view: GraphView,
    ranking: CandidateRanking,
    budget_tokens: int,
    config: Mapping[str, object],
) -> AssemblyResult:
    selector = SectionSelector(
        view=view,
        ranking=ranking,
        budget_tokens=budget_tokens,
        config=config,
    )
    selection = selector.select()
    metrics = PackMetricsBuilder(ranking=ranking, selection=selection).build()
    return AssemblyResult(sections=selection.sections, metrics=metrics)


def pack_graph(
    graph_path: Path,
    intent: str,
    budget_tokens: int,
    diff_paths: Sequence[str],
    config: Mapping[str, object] | None = None,
) -> PackOutput:
    planner = ContextPackPlanner()
    plan = planner.build_plan(
        graph_path=graph_path,
        intent=intent,
        budget_tokens=budget_tokens,
        diff_paths=diff_paths,
        config=config,
    )
    executor = ContextPackExecutor(plan)
    return executor.pack()


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate context packs with PPR scoring")
    parser.add_argument("--graph", type=Path, default=Path("reports/context/graph.json"))
    parser.add_argument("--intent", required=True)
    parser.add_argument("--budget", type=int, default=2000)
    parser.add_argument("--diff", type=Path, nargs="*", default=[])
    parser.add_argument("--config", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=Path("reports/context/pack.json"))
    args = parser.parse_args()
    diff_paths = []
    for diff in args.diff:
        diff_paths.extend(diff.read_text().splitlines())
    config = load_config(args.config) if args.config else None
    planner = ContextPackPlanner()
    plan = planner.build_plan(
        graph_path=args.graph,
        intent=args.intent,
        budget_tokens=args.budget,
        diff_paths=diff_paths,
        config=config,
    )
    executor = ContextPackExecutor(plan)
    result = executor.pack()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
