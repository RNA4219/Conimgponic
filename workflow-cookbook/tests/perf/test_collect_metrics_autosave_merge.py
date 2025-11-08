from __future__ import annotations

import json
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from tools.perf import collect_metrics


def test_collects_merge_precision_mode_metrics(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    metrics_yaml = tmp_path / "metrics.yaml"
    metrics_yaml.write_text(
        textwrap.dedent(
            """
            merge_success_rate: Merge成功率(%)
            merge_conflict_rate: Merge競合率(%)
            merge_autosave_lag_ms: AutoSave連携遅延(ms)
            merge_success_rate_baseline: Merge成功率 baseline(%)
            merge_success_rate_strict: Merge成功率 strict(%)
            merge_conflict_rate_baseline: Merge競合率 baseline(%)
            merge_conflict_rate_strict: Merge競合率 strict(%)
            merge_autosave_lag_ms_baseline: AutoSave連携遅延 baseline(ms)
            merge_autosave_lag_ms_strict: AutoSave連携遅延 strict(ms)
            """
        ).strip()
        + "\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("GOVERNANCE_METRICS_PATH", str(metrics_yaml))
    collect_metrics._load_metric_config.cache_clear()  # type: ignore[attr-defined]
    structured_path = tmp_path / "autosave.log"
    structured_payload = {
        "metrics": {
            "merge.precision_mode": "baseline",
            "merge.success.rate": {"baseline": 0.995},
            "merge.conflict.rate": {"baseline": 0.005},
            "merge.autosave.lag_ms": {"baseline": 150.0},
        }
    }
    structured_path.write_text(json.dumps(structured_payload) + "\n", encoding="utf-8")
    prometheus_text = textwrap.dedent(
        """
        merge.precision_mode{precision_mode="baseline"} 0
        merge.precision_mode{precision_mode="strict"} 1
        merge.success.rate{precision_mode="strict"} 0.982
        merge.conflict.rate{precision_mode="strict"} 0.018
        merge.autosave.lag_ms{precision_mode="strict"} 210
        """
    ).strip()

    try:
        prometheus_metrics = collect_metrics._parse_prometheus(prometheus_text)
        structured_metrics = collect_metrics._load_structured_log(structured_path)
        merged = collect_metrics._merge([prometheus_metrics, structured_metrics])
    finally:
        collect_metrics._load_metric_config.cache_clear()  # type: ignore[attr-defined]

    assert set(merged) == {
        "merge_success_rate",
        "merge_conflict_rate",
        "merge_autosave_lag_ms",
        "merge_success_rate_baseline",
        "merge_success_rate_strict",
        "merge_conflict_rate_baseline",
        "merge_conflict_rate_strict",
        "merge_autosave_lag_ms_baseline",
        "merge_autosave_lag_ms_strict",
    }
    assert merged["merge_success_rate"] == pytest.approx(98.2)
    assert merged["merge_conflict_rate"] == pytest.approx(1.8)
    assert merged["merge_autosave_lag_ms"] == pytest.approx(210.0)
    assert merged["merge_success_rate_baseline"] == pytest.approx(99.5)
    assert merged["merge_success_rate_strict"] == pytest.approx(98.2)
    assert merged["merge_conflict_rate_baseline"] == pytest.approx(0.5)
    assert merged["merge_conflict_rate_strict"] == pytest.approx(1.8)
    assert merged["merge_autosave_lag_ms_baseline"] == pytest.approx(150.0)
    assert merged["merge_autosave_lag_ms_strict"] == pytest.approx(210.0)
