from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import cast
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

import pytest

from tools.context.pack import (
    DEFAULT_CONFIG,
    BaseSignals,
    CandidateRanking,
    CandidateSelector,
    ContextPackPlanner,
    GraphNode,
    GraphEdge,
    GraphView,
    GraphViewBuilder,
    IntentProfile,
    PackMetricsBuilder,
    SectionSelection,
    SectionSelector,
    assemble_sections,
    build_graph_view,
    ContextPackPlanner,
    load_config,
    pack_graph,
    score_candidates,
)
from tools.context.pack import _recency_score


def _recent(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _simple_view(
    *,
    nodes: list[GraphNode],
    edges: list[GraphEdge],
    base_scores: dict[str, float],
    hits: list[str],
    adjacency: dict[str, list[str]] | None = None,
    reverse_adjacency: dict[str, list[str]] | None = None,
) -> GraphView:
    intent_profile = IntentProfile(keywords=[], role=None, halflife=30)
    adjacency_map = adjacency or {}
    reverse_map = reverse_adjacency or {}
    base_signals = {
        cast(str, node["id"]): BaseSignals(0.0, 0.0, 0.0, 0.0, 0.0)
        for node in nodes
        if isinstance(node.get("id"), str)
    }
    return GraphView(
        nodes=nodes,
        edges=edges,
        intent_profile=intent_profile,
        adjacency=adjacency_map,
        reverse_adjacency=reverse_map,
        base_signals=base_signals,
        base_scores=base_scores,
        hits=hits,
    )


@pytest.fixture()
def sample_graph(tmp_path: Path) -> Path:
    graph = {
        "nodes": [
            {
                "id": "docs/a.md#root",
                "path": "docs/a.md",
                "heading": "Root Overview",
                "depth": 1,
                "mtime": _recent(5),
                "token_estimate": 180,
                "role": "spec",
            },
            {
                "id": "docs/a.md#impl",
                "path": "docs/a.md",
                "heading": "Implementation Notes",
                "depth": 2,
                "mtime": _recent(10),
                "token_estimate": 220,
                "role": "impl",
            },
            {
                "id": "docs/b.md#ops",
                "path": "docs/b.md",
                "heading": "Operational Guide",
                "depth": 2,
                "mtime": _recent(2),
                "token_estimate": 200,
                "role": "ops",
            },
        ],
        "edges": [
            {"src": "docs/a.md#root", "dst": "docs/a.md#impl", "type": "parent"},
            {"src": "docs/a.md#impl", "dst": "docs/b.md#ops", "type": "link"},
        ],
        "meta": {"generated_at": "now", "version": "1"},
    }
    path = tmp_path / "graph.json"
    path.write_text(json.dumps(graph))
    return path


def test_pack_graph_prioritises_ppr(sample_graph: Path) -> None:
    result = pack_graph(
        graph_path=sample_graph,
        intent="INT-9 implement rollout",
        budget_tokens=400,
        diff_paths=["docs/b.md"],
        config=DEFAULT_CONFIG,
    )

    assert result["intent"] == "INT-9 implement rollout"
    sections = result["sections"]
    assert sections, "sections should not be empty"
    assert sections[0]["id"] == "docs/b.md#ops"
    assert result["metrics"]["token_in"] <= 400
    pprs = [section["why"]["ppr"] for section in sections]
    assert pprs[0] >= max(pprs[1:]) if len(pprs) > 1 else pprs[0] > 0


def test_context_pack_plan_candidates_and_budget(sample_graph: Path) -> None:
    planner = ContextPackPlanner()
    plan = planner.build_plan(
        graph_path=sample_graph,
        intent="INT-9 implement rollout",
        budget_tokens=400,
        diff_paths=["docs/b.md"],
        config=DEFAULT_CONFIG,
    )

    assert plan.target_candidates[:3] == [
        "docs/b.md#ops",
        "docs/a.md#impl",
        "docs/a.md#root",
    ]
    assert plan.budget_remaining == 20


def test_graph_view_builder_normalises_graph_inputs() -> None:
    builder = GraphViewBuilder(
        graph={"nodes": {"unexpected": True}, "edges": "oops"},
        intent="INT-1 sample",
        diff_paths=[],
        config=DEFAULT_CONFIG,
    )

    nodes = builder.normalize_nodes()
    edges = builder.normalize_edges()

    assert nodes == []
    assert edges == []


def test_graph_view_builder_hits_and_weights(sample_graph: Path) -> None:
    graph = json.loads(sample_graph.read_text())
    config = json.loads(json.dumps(DEFAULT_CONFIG))
    config["weights"] = {
        "intent": 1.0,
        "diff": 0.5,
        "recency": 0.0,
        "hub": 0.0,
        "role": 0.0,
    }
    builder = GraphViewBuilder(
        graph=graph,
        intent="INT-9 implement rollout",
        diff_paths=["docs/b.md"],
        config=config,
    )

    nodes = builder.normalize_nodes()
    edges = builder.normalize_edges()
    profile = builder.build_intent_profile()
    base_signals, base_scores, hits = builder.compute_base_signals(nodes, edges, profile)

    assert hits == [
        "docs/a.md#root",
        "docs/a.md#impl",
        "docs/b.md#ops",
    ]

    impl_signals = base_signals["docs/a.md#impl"]
    ops_signals = base_signals["docs/b.md#ops"]

    assert base_scores["docs/a.md#impl"] == pytest.approx(
        impl_signals.intent * 1.0 + impl_signals.diff * 0.5
    )
    assert base_scores["docs/b.md#ops"] == pytest.approx(
        ops_signals.intent * 1.0 + ops_signals.diff * 0.5
    )


def test_graph_view_builder_limits_candidates_to_two_hops() -> None:
    graph = {
        "nodes": [
            {
                "id": f"n{i}",
                "path": f"docs/n{i}.md",
                "heading": "target" if i == 0 else "other",
                "mtime": _recent(1),
            }
            for i in range(5)
        ],
        "edges": [
            {"src": f"n{i}", "dst": f"n{i + 1}", "type": "link"}
            for i in range(4)
        ],
    }
    config = json.loads(json.dumps(DEFAULT_CONFIG))
    config["weights"] = {
        "intent": 1.0,
        "diff": 0.0,
        "recency": 0.0,
        "hub": 0.0,
        "role": 0.0,
    }
    builder = GraphViewBuilder(
        graph=graph,
        intent="INT-2 target",
        diff_paths=[],
        config=config,
    )

    view = builder.build()
    ranking = score_candidates(view=view, config=config)
    candidate_ids = [node["id"] for node in ranking.candidate_nodes]

    assert candidate_ids == ["n0", "n1", "n2"]


def test_candidate_selector_expands_two_hops() -> None:
    nodes = [{"id": f"n{i}", "token_estimate": 10} for i in range(4)]
    adjacency = {"n0": ["n1"], "n1": ["n2"], "n2": ["n3"]}
    reverse_adj = {"n1": ["n0"], "n2": ["n1"], "n3": ["n2"]}
    base_scores = {f"n{i}": float(4 - i) for i in range(4)}
    view = _simple_view(
        nodes=nodes,
        edges=[],
        base_scores=base_scores,
        hits=["n0"],
        adjacency=adjacency,
        reverse_adjacency=reverse_adj,
    )

    selector = CandidateSelector(view=view, config={})
    selected_ids = [node["id"] for node in selector.select()]

    assert selected_ids == ["n0", "n1", "n2"]


def test_candidate_selector_falls_back_when_empty() -> None:
    nodes = [{"id": f"n{i}", "token_estimate": 5} for i in range(3)]
    base_scores = {f"n{i}": 1.0 for i in range(3)}
    view = _simple_view(
        nodes=nodes,
        edges=[],
        base_scores=base_scores,
        hits=["ghost"],
    )

    selector = CandidateSelector(view=view, config={})
    selected_ids = [node["id"] for node in selector.select()]

    assert selected_ids == ["n0", "n1", "n2"]


def test_candidate_selector_enforces_ncand_limit() -> None:
    nodes = [{"id": f"n{i}", "token_estimate": 5} for i in range(4)]
    base_scores = {f"n{i}": 0.1 * (i + 1) for i in range(4)}
    view = _simple_view(nodes=nodes, edges=[], base_scores=base_scores, hits=[])

    selector = CandidateSelector(view=view, config={"limits": {"ncand": 2}})
    selected_ids = [node["id"] for node in selector.select()]

    assert selected_ids == ["n2", "n3"]


def test_load_config_overrides_defaults(tmp_path: Path, sample_graph: Path) -> None:
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        """
pagerank:
  lambda: 0.70
  theta: 0.5
weights:
  intent: 0.5
limits:
  ncand: 10
        """.strip()
    )

    loaded = load_config(config_path)
    assert loaded["pagerank"]["lambda"] == 0.70
    assert loaded["weights"]["intent"] == 0.5
    assert loaded["limits"]["ncand"] == 10

    result = pack_graph(
        graph_path=sample_graph,
        intent="INT-42 ops",
        budget_tokens=600,
        diff_paths=[],
        config=loaded,
    )

    assert result["metrics"]["token_src"] >= result["metrics"]["token_in"]


def test_build_graph_view_base_signals(sample_graph: Path) -> None:
    graph = json.loads(sample_graph.read_text())
    view = build_graph_view(
        graph=graph,
        intent="INT-9 implement rollout",
        diff_paths=["docs/b.md"],
        config=DEFAULT_CONFIG,
    )

    signals_ops = view.base_signals["docs/b.md#ops"]
    signals_root = view.base_signals["docs/a.md#root"]
    signals_impl = view.base_signals["docs/a.md#impl"]

    assert signals_ops.diff == pytest.approx(1.0)
    assert signals_root.diff == pytest.approx(0.7)
    assert signals_impl.diff == pytest.approx(0.7)
    expected_recency_ops = _recency_score(
        graph["nodes"][2]["mtime"], view.intent_profile.halflife
    )
    assert signals_ops.recency == pytest.approx(expected_recency_ops, rel=1e-6)
    assert signals_root.hub == pytest.approx(1.0)
    assert signals_ops.hub == pytest.approx(0.0)
    assert signals_ops.role == pytest.approx(0.4)


def test_section_selector_respects_budget(sample_graph: Path) -> None:
    graph = json.loads(sample_graph.read_text())
    view = build_graph_view(
        graph=graph,
        intent="INT-budget",
        diff_paths=["docs/a.md"],
        config=DEFAULT_CONFIG,
    )
    ranking = score_candidates(view, DEFAULT_CONFIG)
    selector = SectionSelector(
        view=view,
        ranking=ranking,
        budget_tokens=200,
        config=DEFAULT_CONFIG,
    )
    selection = selector.select()

    assert isinstance(selection, SectionSelection)
    assert selection.token_in <= 200
    assert sum(section["tok"] for section in selection.sections) == selection.token_in


def test_pack_metrics_builder_penalties() -> None:
    node_a = {"id": "docs/a.md#root", "path": "docs/a.md", "token_estimate": 120}
    node_b = {"id": "docs/a.md#impl", "path": "docs/a.md", "token_estimate": 80}
    ranking = CandidateRanking(
        candidate_nodes=[node_a, node_b],
        ppr_scores={"docs/a.md#root": 0.6, "docs/a.md#impl": 0.4},
        scores={"docs/a.md#root": 0.6, "docs/a.md#impl": 0.4},
        ranked_nodes=[node_a, node_b],
    )
    why = {
        "intent": 0.0,
        "diff": 0.0,
        "recency": 0.0,
        "hub": 0.0,
        "role": 0.0,
        "ppr": 0.0,
        "score": 0.0,
    }
    selection = SectionSelection(
        sections=[
            {"id": "docs/a.md#root", "tok": 120, "filters": [], "why": why},
            {"id": "docs/a.md#impl", "tok": 80, "filters": [], "why": why},
        ],
        token_in=200,
        penalties=[1.0, 0.7],
    )

    builder = PackMetricsBuilder(ranking=ranking, selection=selection)
    metrics = builder.build()

    assert metrics["token_in"] == 200
    assert metrics["token_src"] == 200
    assert metrics["dup_rate"] == pytest.approx(0.5)
    assert metrics["diversity_penalty"] == pytest.approx(0.15, rel=1e-6)


def test_score_candidates_respects_existing_ordering(sample_graph: Path) -> None:
    graph = json.loads(sample_graph.read_text())
    view = build_graph_view(
        graph=graph,
        intent="INT-9 implement rollout",
        diff_paths=["docs/b.md"],
        config=DEFAULT_CONFIG,
    )

    ranking = score_candidates(view=view, config=DEFAULT_CONFIG)

    candidate_ids = [node["id"] for node in ranking.candidate_nodes]
    assert candidate_ids == [
        "docs/a.md#root",
        "docs/a.md#impl",
        "docs/b.md#ops",
    ]
    assert ranking.ppr_scores["docs/b.md#ops"] >= ranking.ppr_scores["docs/a.md#root"]


def test_assemble_sections_matches_pack_graph(sample_graph: Path) -> None:
    graph = json.loads(sample_graph.read_text())
    view = build_graph_view(
        graph=graph,
        intent="INT-9 implement rollout",
        diff_paths=["docs/b.md"],
        config=DEFAULT_CONFIG,
    )
    ranking = score_candidates(view=view, config=DEFAULT_CONFIG)
    assembly = assemble_sections(
        view=view,
        ranking=ranking,
        budget_tokens=400,
        config=DEFAULT_CONFIG,
    )

    result = pack_graph(
        graph_path=sample_graph,
        intent="INT-9 implement rollout",
        budget_tokens=400,
        diff_paths=["docs/b.md"],
        config=DEFAULT_CONFIG,
    )

    for helper_section, packed_section in zip(assembly.sections, result["sections"]):
        assert helper_section["id"] == packed_section["id"]
        assert helper_section["tok"] == packed_section["tok"]
        assert helper_section["filters"] == packed_section["filters"]
        for key in ["intent", "diff", "recency", "hub", "role", "ppr", "score"]:
            assert helper_section["why"][key] == pytest.approx(
                packed_section["why"][key], rel=1e-6, abs=1e-9
            )
    for key, value in assembly.metrics.items():
        assert value == pytest.approx(result["metrics"][key], rel=1e-6, abs=1e-9)


def test_cli_main_emits_pack_output(
    tmp_path: Path, sample_graph: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    diff_path = tmp_path / "diff.txt"
    diff_path.write_text("docs/b.md\n")
    output_path = tmp_path / "pack.json"

    expected = pack_graph(
        graph_path=sample_graph,
        intent="INT-9 implement rollout",
        budget_tokens=400,
        diff_paths=["docs/b.md"],
        config=None,
    )

    args = [
        "context-pack",
        "--graph",
        str(sample_graph),
        "--intent",
        "INT-9 implement rollout",
        "--budget",
        "400",
        "--diff",
        str(diff_path),
        "--output",
        str(output_path),
    ]
    monkeypatch.setattr(sys, "argv", args)

    from tools.context import pack as pack_module

    pack_module.main()

    result = json.loads(output_path.read_text())

    assert result["intent"] == expected["intent"]
    assert result["budget"] == expected["budget"]
    assert len(result["sections"]) == len(expected["sections"])
    for res_section, exp_section in zip(result["sections"], expected["sections"]):
        assert res_section["id"] == exp_section["id"]
        assert res_section["tok"] == exp_section["tok"]
        assert res_section["filters"] == exp_section["filters"]
        for key in ["intent", "diff", "recency", "hub", "role", "ppr", "score"]:
            assert res_section["why"][key] == pytest.approx(
                exp_section["why"][key], rel=1e-6, abs=1e-9
            )
    for key, value in result["metrics"].items():
        assert value == pytest.approx(expected["metrics"][key], rel=1e-6, abs=1e-9)
