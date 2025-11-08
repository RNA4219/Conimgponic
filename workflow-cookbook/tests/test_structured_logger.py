from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.perf.structured_logger import StructuredLogger


@pytest.fixture
def log_path(tmp_path: Path) -> Path:
    return tmp_path / "chainlit.log"


def test_structured_logger_writes_inference_records(log_path: Path) -> None:
    logger = StructuredLogger(name="workflow.metrics", path=log_path)

    logger.inference(
        inference_id="run-42",
        model="gpt-4.1-mini",
        prompt={"messages": [{"role": "user", "content": "Ping"}]},
        response={"content": "Pong", "finish_reason": "stop"},
        metrics={
            "semantic_retention": 0.82,
            "spec_completeness": {"with_spec": 91, "total": 100},
        },
        tags=("qa", "integration"),
        extra={"run": "test"},
    )

    contents = log_path.read_text(encoding="utf-8").splitlines()
    assert len(contents) == 1

    payload = json.loads(contents[0])
    assert payload["logger"] == "workflow.metrics"
    assert payload["event"] == "inference"
    assert payload["level"] == "INFO"
    assert payload["metrics"] == {
        "semantic_retention": 0.82,
        "spec_completeness": {"with_spec": 91, "total": 100},
    }
    assert payload["prompt"] == {"messages": [{"role": "user", "content": "Ping"}]}
    assert payload["response"] == {"content": "Pong", "finish_reason": "stop"}
    assert payload["tags"] == ["qa", "integration"]
    assert payload["extra"] == {"run": "test"}
    assert payload["inference_id"] == "run-42"
    assert payload["model"] == "gpt-4.1-mini"
    assert isinstance(payload["timestamp"], str)

    # Chainlit のログ収集と互換なメトリクス構造を確認
    assert payload["metrics"]["spec_completeness"]["with_spec"] == 91
    assert payload["metrics"]["spec_completeness"]["total"] == 100
