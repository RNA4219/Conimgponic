from __future__ import annotations

import io
import json
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping

import pytest

from tools.autosave.project_lock_service import LockTokenInvalidError, ProjectLockCoordinator
from tools.merge.precision_mode_pipeline import (
    MergeExecutionResult,
    MergeOperation,
    MergePipeline,
    MergePipelineRequest,
    MergeMetricsTracker,
)
from tools.perf.structured_logger import StructuredLogger


class StubFlagState:
    def __init__(self, mode: str = "baseline") -> None:
        self._mode = mode

    def merge_precision_mode(self) -> str:
        return self._mode

    def set_mode(self, mode: str) -> None:
        self._mode = mode


class StubCoordinator(ProjectLockCoordinator):
    def __init__(self) -> None:
        self.validations: List[tuple[str, str]] = []
        self.releases: List[tuple[str, str]] = []
        self._valid_tokens: Dict[tuple[str, str], bool] = {}

    def allow(self, project_id: str, token: str, *, valid: bool = True) -> None:
        self._valid_tokens[(project_id, token)] = valid

    def validate_token(self, project_id: str, token: str) -> bool:
        self.validations.append((project_id, token))
        return self._valid_tokens.get((project_id, token), False)

    def lock_release(self, project_id: str, token: str) -> None:
        self.releases.append((project_id, token))


class StubTelemetry:
    def __init__(self) -> None:
        self.events: List[tuple[str, Mapping[str, Any]]] = []

    def emit(self, event: str, payload: Mapping[str, Any]) -> None:
        self.events.append((event, dict(payload)))


@dataclass
class StubExecutor:
    next_status: str = "merged"

    def __call__(self, operation: MergeOperation) -> MergeExecutionResult:
        resolved = operation.last_applied_snapshot_id + 1
        status = self.next_status
        self.next_status = "merged"
        return MergeExecutionResult(status=status, resolved_snapshot_id=resolved)


def _log_lines(stream: io.StringIO) -> List[dict[str, Any]]:
    return [json.loads(line) for line in stream.getvalue().splitlines() if line]


def _tracker(logger: StructuredLogger, telemetry: StubTelemetry) -> MergeMetricsTracker:
    return MergeMetricsTracker(logger=logger, telemetry=telemetry)


def test_metrics_tracker_records_success_rate() -> None:
    stream = io.StringIO()
    logger = StructuredLogger(name="workflow.merge", stream=stream)
    telemetry = StubTelemetry()
    tracker = _tracker(logger, telemetry)

    request = MergePipelineRequest(
        project_id="project-1",
        request_id="req-success",
        merged_snapshot={"id": 1},
        last_applied_snapshot_id=0,
        lock_token=None,
    )
    tracker.record_outcome(
        precision_mode="baseline",
        status="merged",
        request=request,
        lock_validated=False,
        resolved_snapshot_id=1,
    )

    snapshot = tracker.snapshot()
    assert snapshot["merge.success.rate|precision_mode=baseline"] == pytest.approx(1.0)
    assert snapshot["merge.precision_mode|precision_mode=baseline"] == pytest.approx(1.0)
    assert telemetry.events[-1][1]["status"] == "merged"


def test_metrics_tracker_records_conflict_rate() -> None:
    stream = io.StringIO()
    logger = StructuredLogger(name="workflow.merge", stream=stream)
    telemetry = StubTelemetry()
    tracker = _tracker(logger, telemetry)

    request = MergePipelineRequest(
        project_id="project-1",
        request_id="req-conflict",
        merged_snapshot={"id": 1},
        last_applied_snapshot_id=0,
        lock_token=None,
    )
    tracker.record_outcome(
        precision_mode="strict",
        status="conflicted",
        request=request,
        lock_validated=False,
        resolved_snapshot_id=None,
    )

    snapshot = tracker.snapshot()
    assert snapshot["merge.conflict.rate|precision_mode=strict"] == pytest.approx(1.0)
    assert telemetry.events[-1][1]["status"] == "conflicted"


def test_metrics_tracker_updates_lag_independently() -> None:
    stream = io.StringIO()
    logger = StructuredLogger(name="workflow.merge", stream=stream)
    telemetry = StubTelemetry()
    tracker = _tracker(logger, telemetry)

    request = MergePipelineRequest(
        project_id="project-1",
        request_id="req-lag",
        merged_snapshot={"id": 1},
        last_applied_snapshot_id=0,
        lock_token=None,
        autosave_lag_ms=42.0,
    )
    tracker.record_outcome(
        precision_mode="strict",
        status="merged",
        request=request,
        lock_validated=True,
        resolved_snapshot_id=1,
    )

    snapshot = tracker.snapshot()
    assert snapshot["merge.autosave.lag_ms|precision_mode=strict"] == pytest.approx(42.0)
    assert telemetry.events[-1][1]["merge.autosave.lag_ms"] == pytest.approx(42.0)


def test_precision_pipeline_handles_mode_transitions() -> None:
    telemetry = StubTelemetry()
    coordinator = StubCoordinator()
    flags = StubFlagState(mode="baseline")
    stream = io.StringIO()
    logger = StructuredLogger(name="workflow.merge", stream=stream)
    executor = StubExecutor()
    pipeline = MergePipeline(
        flag_state=flags,
        coordinator=coordinator,
        telemetry=telemetry,
        logger=logger,
        executor=executor,
    )

    coordinator.allow("project-1", "token-1")
    request = MergePipelineRequest(
        project_id="project-1",
        request_id="req-1",
        merged_snapshot={"id": 11},
        last_applied_snapshot_id=10,
        lock_token="token-1",
        autosave_lag_ms=120.0,
        latency_ms=85.0,
        lock_wait_ms=18.0,
    )
    result = pipeline.run(request)
    assert result.status == "merged"
    assert coordinator.validations == [("project-1", "token-1")]
    assert coordinator.releases == [("project-1", "token-1")]

    event_name, payload = telemetry.events[-1]
    assert event_name == "merge.pipeline.metrics"
    assert payload["precision_mode"] == "baseline"
    assert payload["merge.success.rate"] == pytest.approx(1.0)
    assert payload["merge.conflict.rate"] == pytest.approx(0.0)
    assert payload["merge.autosave.lag_ms"] == pytest.approx(120.0)
    assert payload["latency_ms"] == pytest.approx(85.0)
    assert payload["lock_wait_ms"] == pytest.approx(18.0)

    logs = _log_lines(stream)
    assert logs[-1]["metrics"]["merge.precision_mode"] == "baseline"
    assert logs[-1]["metrics"]["merge.success.rate"]["baseline"] == pytest.approx(1.0)

    flags.set_mode("strict")
    strict_request = MergePipelineRequest(
        project_id="project-1",
        request_id="req-2",
        merged_snapshot={"id": 12},
        last_applied_snapshot_id=11,
        lock_token="token-invalid",
        autosave_lag_ms=210.0,
        latency_ms=130.0,
        lock_wait_ms=42.0,
    )
    with pytest.raises(LockTokenInvalidError):
        pipeline.run(strict_request)
    assert coordinator.releases == [("project-1", "token-1")]

    _, conflict_payload = telemetry.events[-1]
    assert conflict_payload["precision_mode"] == "strict"
    assert conflict_payload["status"] == "conflicted"
    assert conflict_payload["merge.conflict.rate"] == pytest.approx(1.0)

    coordinator.allow("project-1", "token-2")
    strict_success = MergePipelineRequest(
        project_id="project-1",
        request_id="req-3",
        merged_snapshot={"id": 13},
        last_applied_snapshot_id=12,
        lock_token="token-2",
        autosave_lag_ms=90.0,
        latency_ms=70.0,
        lock_wait_ms=10.0,
    )
    executor.next_status = "merged"
    result = pipeline.run(strict_success)
    assert result.status == "merged"
    assert coordinator.releases[-1] == ("project-1", "token-2")

    _, strict_payload = telemetry.events[-1]
    assert strict_payload["precision_mode"] == "strict"
    assert strict_payload["merge.success.rate"] == pytest.approx(0.5)
    assert strict_payload["merge.conflict.rate"] == pytest.approx(0.5)

    flags.set_mode("baseline")
    coordinator.allow("project-1", "token-3")
    final_request = MergePipelineRequest(
        project_id="project-1",
        request_id="req-4",
        merged_snapshot={"id": 14},
        last_applied_snapshot_id=13,
        lock_token="token-3",
        autosave_lag_ms=110.0,
        latency_ms=75.0,
        lock_wait_ms=12.0,
    )
    result = pipeline.run(final_request)
    assert result.status == "merged"
    snapshot = pipeline.metrics_snapshot()
    assert snapshot["merge.success.rate|precision_mode=baseline"] == pytest.approx(1.0)
    assert snapshot["merge.conflict.rate|precision_mode=strict"] == pytest.approx(0.5)
    assert snapshot["merge.autosave.lag_ms|precision_mode=strict"] == pytest.approx(90.0)
    assert snapshot["merge.precision_mode|precision_mode=baseline"] == pytest.approx(1.0)
    assert snapshot["merge.precision_mode|precision_mode=strict"] == pytest.approx(0.0)

