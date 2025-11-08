"""governance.metrics.yaml の内容を検証するテスト。"""
import importlib
import sys
from pathlib import Path
from typing import Dict

REPO_ROOT = Path(__file__).resolve().parents[1]
if (repo_root := str(REPO_ROOT)) not in sys.path:
    sys.path.insert(0, repo_root)

import tools.perf.collect_metrics as collect_metrics

try:
    import yaml
except ModuleNotFoundError:  # pragma: no cover - fallback for minimal env
    class _MiniYamlModule:
        @staticmethod
        def safe_load(content: str) -> Dict[str, str]:
            result: Dict[str, str] = {}
            for line in content.splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                key, _, value = stripped.partition(":")
                result[key.strip()] = value.strip()
            return result

    yaml = _MiniYamlModule()  # type: ignore[assignment]


def test_governance_metrics_contains_required_keys() -> None:
    metrics_path = Path("governance/metrics.yaml")
    metrics_data = yaml.safe_load(metrics_path.read_text(encoding="utf-8"))

    assert isinstance(metrics_data, dict)

    expected_keys = set(collect_metrics.metric_keys())
    actual_keys = set(metrics_data)

    missing_keys = expected_keys - actual_keys
    assert not missing_keys, "Missing metrics: " + ", ".join(sorted(missing_keys))


def test_governance_scale_annotations_match_percentage_keys() -> None:
    metrics_path = Path("governance/metrics.yaml")
    metrics_data = yaml.safe_load(metrics_path.read_text(encoding="utf-8"))

    assert isinstance(metrics_data, dict)

    annotated_percent = {
        key for key, description in metrics_data.items() if "(%)" in str(description)
    }
    annotated_zero_to_one = {
        key for key, description in metrics_data.items() if "(0-1)" in str(description)
    }

    percentage_keys = set(collect_metrics.percentage_keys())

    assert annotated_percent <= percentage_keys
    assert annotated_zero_to_one.isdisjoint(annotated_percent)
    for key in percentage_keys:
        assert key in annotated_percent or key in annotated_zero_to_one


def test_metric_loader_reflects_yaml_changes(
    monkeypatch: "pytest.MonkeyPatch", tmp_path: Path
) -> None:
    metrics_yaml = tmp_path / "metrics.yaml"
    metrics_yaml.write_text(
        "\n".join(
            (
                "checklist_compliance_rate: チェックリスト準拠率(0-1)",
                "task_seed_cycle_time_minutes: Task Seed 処理時間(分)",
                "birdseye_refresh_delay_minutes: Birdseye 更新遅延(分)",
                "review_latency: レビュー待機時間(時間)",
                "compress_ratio: トリミング後のコンテキスト圧縮率(0-1)",
                "semantic_retention: トリミング後に保持された意味情報の割合(0-1)",
                "reopen_rate: 再オープン率(0-1)",
                "spec_completeness: スペック充足率(%)",
            )
        )
        + "\n",
        encoding="utf-8",
    )

    monkeypatch.setenv("GOVERNANCE_METRICS_PATH", str(metrics_yaml))
    module = importlib.reload(collect_metrics)
    try:
        assert list(module.metric_keys()) == [
            "checklist_compliance_rate",
            "task_seed_cycle_time_minutes",
            "birdseye_refresh_delay_minutes",
            "review_latency",
            "compress_ratio",
            "semantic_retention",
            "reopen_rate",
            "spec_completeness",
        ]
        percentage = set(module.percentage_keys())
        assert "checklist_compliance_rate" not in percentage
        assert "reopen_rate" not in percentage
        assert "spec_completeness" in percentage
    finally:
        monkeypatch.delenv("GOVERNANCE_METRICS_PATH", raising=False)
        importlib.reload(collect_metrics)
