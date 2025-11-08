from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, Mapping, Protocol, Literal

from tools.autosave.project_lock_service import LockTokenInvalidError, ProjectLockCoordinator
from tools.perf.structured_logger import StructuredLogger

PrecisionMode = Literal["baseline", "strict"]


class FlagState(Protocol):
    def merge_precision_mode(self) -> str:
        ...


class TelemetrySink(Protocol):
    def emit(self, event: str, payload: Mapping[str, object]) -> None:
        ...


@dataclass(frozen=True)
class MergePipelineRequest:
    project_id: str
    request_id: str
    merged_snapshot: Mapping[str, object]
    last_applied_snapshot_id: int
    lock_token: str | None
    autosave_lag_ms: float | None = None
    latency_ms: float | None = None
    lock_wait_ms: float | None = None
    precision_mode_override: str | None = None


@dataclass(frozen=True)
class MergeOperation:
    project_id: str
    merged_snapshot: Mapping[str, object]
    last_applied_snapshot_id: int
    lock_token: str | None
    precision_mode: PrecisionMode


@dataclass(frozen=True)
class MergeExecutionResult:
    status: Literal["merged", "conflicted", "rolled_back"]
    resolved_snapshot_id: int | None = None


@dataclass(frozen=True)
class MergePipelineResult:
    status: Literal["merged", "conflicted", "rolled_back"]
    precision_mode: PrecisionMode
    resolved_snapshot_id: int | None
    lock_released: bool


MergeExecutor = Callable[[MergeOperation], MergeExecutionResult]


@dataclass(frozen=True)
class MergeSessionState:
    request: MergePipelineRequest
    precision_mode: PrecisionMode
    lock_token: str | None
    lock_validated: bool


class MergeSession:
    def __init__(
        self,
        *,
        flag_state: FlagState,
        coordinator: ProjectLockCoordinator,
    ) -> None:
        self._flag_state = flag_state
        self._coordinator = coordinator

    def create_state(self, request: MergePipelineRequest) -> MergeSessionState:
        mode = self._resolve_mode(
            request.precision_mode_override or self._flag_state.merge_precision_mode()
        )
        lock_token = request.lock_token
        lock_validated = False
        if lock_token:
            lock_validated = self._coordinator.validate_token(request.project_id, lock_token)
        return MergeSessionState(
            request=request,
            precision_mode=mode,
            lock_token=lock_token,
            lock_validated=lock_validated,
        )

    def release_lock(self, state: MergeSessionState) -> bool:
        if state.lock_token and (state.lock_validated or state.precision_mode == "baseline"):
            self._coordinator.lock_release(state.request.project_id, state.lock_token)
            return True
        return False

    @staticmethod
    def _resolve_mode(candidate: str | None) -> PrecisionMode:
        if candidate == "strict":
            return "strict"
        return "baseline"


class MergeMetricsTracker:
    def __init__(
        self,
        *,
        telemetry: TelemetrySink,
        logger: StructuredLogger,
    ) -> None:
        self._telemetry = telemetry
        self._logger = logger
        self._totals: Dict[str, int] = {}
        self._successes: Dict[str, int] = {}
        self._conflicts: Dict[str, int] = {}
        self._lag_ms: Dict[str, float] = {}
        self._mode_gauges: Dict[str, float] = {"baseline": 0.0, "strict": 0.0}

    def record_outcome(
        self,
        *,
        precision_mode: PrecisionMode,
        status: Literal["merged", "conflicted", "rolled_back"],
        request: MergePipelineRequest,
        lock_validated: bool,
        resolved_snapshot_id: int | None,
    ) -> None:
        totals = self._totals.get(precision_mode, 0) + 1
        self._totals[precision_mode] = totals
        if status == "merged":
            self._successes[precision_mode] = self._successes.get(precision_mode, 0) + 1
        else:
            self._conflicts[precision_mode] = self._conflicts.get(precision_mode, 0) + 1
        if request.autosave_lag_ms is not None:
            self._lag_ms[precision_mode] = request.autosave_lag_ms
        self._mode_gauges = {
            key: 1.0 if key == precision_mode else 0.0 for key in self._mode_gauges
        }
        success_rates, conflict_rates, lag = self._compose_metrics()
        payload: Dict[str, object] = {
            "precision_mode": precision_mode,
            "status": status,
            "merge.success.rate": success_rates.get(precision_mode, 0.0),
            "merge.conflict.rate": conflict_rates.get(precision_mode, 0.0),
            "merge.autosave.lag_ms": lag.get(precision_mode),
            "lock_validated": lock_validated,
            "resolved_snapshot_id": resolved_snapshot_id,
        }
        if request.latency_ms is not None:
            payload["latency_ms"] = request.latency_ms
        if request.lock_wait_ms is not None:
            payload["lock_wait_ms"] = request.lock_wait_ms
        self._telemetry.emit("merge.pipeline.metrics", payload)

        metrics_payload: Dict[str, Mapping[str, float] | str] = {
            "merge.precision_mode": precision_mode,
            "merge.success.rate": success_rates,
            "merge.conflict.rate": conflict_rates,
            "merge.autosave.lag_ms": lag,
        }
        extra: Dict[str, object] = {
            "status": status,
            "project_id": request.project_id,
            "request_id": request.request_id,
            "lock_validated": lock_validated,
        }
        self._logger.inference(
            inference_id=request.request_id,
            metrics=metrics_payload,
            extra=extra,
        )

    def snapshot(self) -> Mapping[str, float]:
        success_rates, conflict_rates, lag = self._compose_metrics()
        snapshot: Dict[str, float] = {}
        for mode, value in success_rates.items():
            snapshot[f"merge.success.rate|precision_mode={mode}"] = value
        for mode, value in conflict_rates.items():
            snapshot[f"merge.conflict.rate|precision_mode={mode}"] = value
        for mode, value in lag.items():
            snapshot[f"merge.autosave.lag_ms|precision_mode={mode}"] = value
        for mode, gauge in self._mode_gauges.items():
            snapshot[f"merge.precision_mode|precision_mode={mode}"] = gauge
        return snapshot

    def _compose_metrics(self) -> tuple[Dict[str, float], Dict[str, float], Dict[str, float]]:
        success_rates: Dict[str, float] = {}
        conflict_rates: Dict[str, float] = {}
        for mode, total in self._totals.items():
            if total == 0:
                continue
            success = self._successes.get(mode, 0)
            conflict = self._conflicts.get(mode, 0)
            success_rates[mode] = success / total
            conflict_rates[mode] = conflict / total
        return success_rates, conflict_rates, dict(self._lag_ms)


class MergePipeline:
    def __init__(
        self,
        *,
        flag_state: FlagState,
        coordinator: ProjectLockCoordinator,
        telemetry: TelemetrySink,
        logger: StructuredLogger,
        executor: MergeExecutor,
    ) -> None:
        self._session = MergeSession(flag_state=flag_state, coordinator=coordinator)
        self._tracker = MergeMetricsTracker(telemetry=telemetry, logger=logger)
        self._executor = executor

    def run(self, request: MergePipelineRequest) -> MergePipelineResult:
        state = self._session.create_state(request)
        if state.precision_mode == "strict" and not state.lock_validated:
            self._tracker.record_outcome(
                precision_mode=state.precision_mode,
                status="conflicted",
                request=request,
                lock_validated=False,
                resolved_snapshot_id=None,
            )
            raise LockTokenInvalidError("Merge requires a valid lock_token in strict precision mode")
        operation = MergeOperation(
            project_id=request.project_id,
            merged_snapshot=request.merged_snapshot,
            last_applied_snapshot_id=request.last_applied_snapshot_id,
            lock_token=state.lock_token,
            precision_mode=state.precision_mode,
        )
        execution = self._executor(operation)
        status = execution.status
        if status not in {"merged", "conflicted", "rolled_back"}:
            status = "conflicted"
        lock_released = self._session.release_lock(state)
        self._tracker.record_outcome(
            precision_mode=state.precision_mode,
            status=status,
            request=request,
            lock_validated=state.lock_validated,
            resolved_snapshot_id=execution.resolved_snapshot_id,
        )
        return MergePipelineResult(
            status=status,
            precision_mode=state.precision_mode,
            resolved_snapshot_id=execution.resolved_snapshot_id,
            lock_released=lock_released,
        )

    def metrics_snapshot(self) -> Mapping[str, float]:
        return self._tracker.snapshot()


__all__ = [
    "MergeExecutionResult",
    "MergeOperation",
    "MergePipeline",
    "MergePipelineRequest",
    "MergePipelineResult",
    "MergeMetricsTracker",
    "MergeSession",
    "MergeSessionState",
]
