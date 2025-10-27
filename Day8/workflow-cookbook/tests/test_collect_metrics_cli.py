from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import tools.perf.collect_metrics as collect_metrics_module


def _run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "tools.perf.collect_metrics", *args],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        check=False,
    )


def test_collects_metrics_from_prometheus_and_chainlit(tmp_path: Path) -> None:
    prometheus = tmp_path / "metrics.prom"
    prometheus.write_text(
        """# HELP compress_ratio Ratio\n# TYPE compress_ratio gauge\ncompress_ratio 0.82\n""",
        encoding="utf-8",
    )

    chainlit = tmp_path / "chainlit.log"
    chainlit.write_text(
        """{"metrics": {"semantic_retention": 0.74}}\n""",
        encoding="utf-8",
    )

    result = _run_cli("--metrics-url", prometheus.as_uri(), "--log-path", str(chainlit))

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload == {"compress_ratio": 0.82, "semantic_retention": 0.74}


def test_exits_non_zero_when_metrics_missing(tmp_path: Path) -> None:
    prometheus = tmp_path / "metrics.prom"
    prometheus.write_text("up 1\n", encoding="utf-8")

    chainlit = tmp_path / "chainlit.log"
    chainlit.write_text("{}\n", encoding="utf-8")

    result = _run_cli("--metrics-url", prometheus.as_uri(), "--log-path", str(chainlit))

    assert result.returncode != 0
    assert "compress_ratio" in result.stderr
    assert "semantic_retention" in result.stderr


def test_metric_definition_table_covers_expected_sources() -> None:
    definitions = {definition.key: definition for definition in collect_metrics_module.METRIC_DEFINITIONS}

    compress_ratio = definitions["compress_ratio"]
    assert compress_ratio.prometheus_names == ("compress_ratio",)
    assert ("compress_ratio",) in compress_ratio.log_paths

    semantic_retention = definitions["semantic_retention"]
    assert semantic_retention.prometheus_names == ("semantic_retention",)
    assert ("metrics", "semantic_retention") in semantic_retention.log_paths


def test_metric_resolution_prefers_prometheus_over_logs() -> None:
    prometheus_values = {"compress_ratio": 0.61}
    log_entries = [
        {"metrics": {"compress_ratio": 0.71, "semantic_retention": 0.92}},
        {"semantic_retention": 0.91},
    ]

    resolved = collect_metrics_module._resolve_metrics(prometheus_values, log_entries)

    assert resolved == {"compress_ratio": 0.61, "semantic_retention": 0.92}
