from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


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
