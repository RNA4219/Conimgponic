from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if (repo_root := str(ROOT)) not in sys.path:
    sys.path.insert(0, repo_root)

from tools.perf.metrics_registry import MetricsRegistry  # noqa: E402


def _by_labels(entries: list[dict[str, object]], *, labels: dict[str, str]) -> dict[str, object]:
    for entry in entries:
        if entry.get("labels") == labels:
            return entry
    raise AssertionError(f"entry with labels {labels!r} not found: {entries!r}")


def _parse_prometheus(text: str) -> dict[tuple[str, tuple[tuple[str, str], ...]], float]:
    parsed: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        name, raw_value = line.split(None, 1)
        if "{" in name:
            metric, raw_labels = name.split("{", 1)
            label_pairs = []
            for item in raw_labels.rstrip("}").split(","):
                if not item:
                    continue
                key, value = item.split("=", 1)
                label_pairs.append((key, value.strip('"')))
            labels = tuple(sorted(label_pairs))
        else:
            metric = name
            labels = ()
        parsed[(metric, labels)] = float(raw_value)
    return parsed


def test_export_prometheus_after_observing_trim() -> None:
    registry = MetricsRegistry(default_labels={"service": "workflow"})

    registry.observe_trim(
        compress_ratio=0.4,
        semantic_retention=0.92,
        labels={"model": "gpt-5"},
    )
    registry.observe_trim(
        compress_ratio=0.5,
        labels={"model": "gpt-5"},
    )

    snapshot = registry.snapshot()
    compress_entries = snapshot["context_compression_ratio"]
    compress = _by_labels(
        compress_entries,
        labels={"model": "gpt-5", "service": "workflow"},
    )
    assert compress["count"] == 2
    assert compress["sum"] == pytest.approx(0.9)
    assert compress["avg"] == pytest.approx(0.45)
    assert compress["min"] == pytest.approx(0.4)
    assert compress["max"] == pytest.approx(0.5)

    semantic_entries = snapshot["context_semantic_retention"]
    semantic = _by_labels(
        semantic_entries,
        labels={"model": "gpt-5", "service": "workflow"},
    )
    assert semantic["count"] == 1
    assert semantic["sum"] == pytest.approx(0.92)
    assert semantic["avg"] == pytest.approx(0.92)
    assert semantic["min"] == pytest.approx(0.92)
    assert semantic["max"] == pytest.approx(0.92)

    prometheus = registry.export_prometheus()
    metrics = _parse_prometheus(prometheus)
    labels = (("model", "gpt-5"), ("service", "workflow"))

    assert metrics[("context_compression_ratio_count", labels)] == pytest.approx(2)
    assert metrics[("context_compression_ratio_sum", labels)] == pytest.approx(0.9)
    assert metrics[("context_compression_ratio_avg", labels)] == pytest.approx(0.45)
    assert metrics[("context_compression_ratio_min", labels)] == pytest.approx(0.4)
    assert metrics[("context_compression_ratio_max", labels)] == pytest.approx(0.5)

    assert metrics[("context_semantic_retention_count", labels)] == pytest.approx(1)
    assert metrics[("context_semantic_retention_sum", labels)] == pytest.approx(0.92)
    assert metrics[("context_semantic_retention_avg", labels)] == pytest.approx(0.92)
    assert metrics[("context_semantic_retention_min", labels)] == pytest.approx(0.92)
    assert metrics[("context_semantic_retention_max", labels)] == pytest.approx(0.92)


def test_observe_trim_accepts_token_counts_and_exports_gauges() -> None:
    registry = MetricsRegistry(default_labels={"service": "workflow"})

    registry.observe_trim(
        original_tokens=1200,
        trimmed_tokens=660,
        semantic_retention=0.83,
        labels={"model": "gpt-5"},
    )
    registry.observe_trim(
        compress_ratio=0.52,
        semantic_retention=0.9,
        labels={"model": "gpt-5"},
    )
    token_ratio = 660 / 1200
    snapshot = registry.snapshot()
    target_labels = {"model": "gpt-5", "service": "workflow"}
    metrics = _parse_prometheus(registry.export_prometheus())
    label_tuple = tuple(sorted(target_labels.items()))
    expectations = {
        "context_compression_ratio": ((token_ratio, 0.52), "compress_ratio"),
        "context_semantic_retention": ((0.83, 0.9), "semantic_retention"),
    }
    for metric_name, (values, gauge) in expectations.items():
        total = sum(values)
        expectation = {
            "count": len(values),
            "sum": total,
            "avg": total / len(values),
            "min": min(values),
            "max": max(values),
        }
        entry = _by_labels(snapshot[metric_name], labels=target_labels)
        for key, value in expectation.items():
            assert entry[key] == pytest.approx(value)
            assert metrics[(f"{metric_name}_{key}", label_tuple)] == pytest.approx(value)
        assert metrics[(gauge, label_tuple)] == pytest.approx(expectation["avg"])
