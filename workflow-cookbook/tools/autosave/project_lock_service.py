"""AutoSave project lock service implementation.

The service fulfils the I/O contract and exception policy described in
``docs/AUTOSAVE-DESIGN-IMPL.md`` and cooperates with Merge per
``docs/MERGE-DESIGN-IMPL.md``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Mapping, MutableMapping, Optional, Protocol

from tools.provider_spi import ensure_autosave_rollout_enabled

logger = logging.getLogger("autosave.project_lock")


class TelemetryEmitter(Protocol):
    """Protocol for emitting structured telemetry events."""

    def emit(self, event: str, payload: Mapping[str, Any]) -> None:
        """Emit *event* with *payload* to the configured backend."""


class ProjectLockCoordinator(Protocol):
    """Merge-facing coordinator responsible for lock lifecycle."""

    def validate_token(self, project_id: str, token: str) -> bool:
        """Return ``True`` when *token* is valid for *project_id*."""

    def lock_release(self, project_id: str, token: str) -> None:
        """Notify Merge that AutoSave released the lock."""


class FlagState(Protocol):
    """Typed accessor for staged rollout feature flags."""

    def autosave_project_lock_enabled(self) -> bool:
        """Return True when ``autosave.project_lock`` is active."""

    def merge_precision_mode(self) -> str:
        """Return the configured ``merge.precision_mode``."""

    def autosave_rollout_checklist_completed(self) -> bool:
        """Return True when rollout checklist requirements are satisfied."""


@dataclass(frozen=True)
class AutoSaveRequest:
    """Input payload defined by the AutoSave I/O contract."""

    project_id: str
    snapshot_delta: Mapping[str, Any]
    lock_token: str
    snapshot_id: int
    timestamp: datetime
    precision_mode: str


@dataclass(frozen=True)
class AutoSaveResult:
    """Output payload expected by the AutoSave I/O contract."""

    status: str
    applied_snapshot_id: Optional[int]
    next_retry_at: Optional[datetime]


class ProjectLockError(RuntimeError):
    """Base class for AutoSave project lock failures."""


class LockTokenInvalidError(ProjectLockError):
    """Retryable error raised when Merge supplied an invalid token."""


class SnapshotOrderViolation(ProjectLockError):
    """Non-retryable error raised when snapshot monotonicity is violated."""


@dataclass
class StaticFlagState(FlagState):
    """Static implementation that satisfies the staged rollout checklist.

    The defaults keep ``autosave.project_lock`` enabled and ``merge.precision_mode``
    in ``strict`` mode so that integration tests can exercise retry behaviour per
    ``docs/IMPLEMENTATION-PLAN.md#段階導入チェックリスト``.
    """

    autosave_project_lock: bool = True
    precision_mode: str = "strict"
    checklist_completed: bool = True

    def autosave_project_lock_enabled(self) -> bool:
        return self.autosave_project_lock

    def merge_precision_mode(self) -> str:
        return self.precision_mode

    def autosave_rollout_checklist_completed(self) -> bool:
        return self.checklist_completed


class ProjectLockService:
    """Coordinate AutoSave snapshot commits with Merge locks."""

    def __init__(
        self,
        *,
        coordinator: ProjectLockCoordinator,
        telemetry: TelemetryEmitter,
        flag_state: FlagState,
    ) -> None:
        self._coordinator = coordinator
        self._telemetry = telemetry
        self._flag_state = flag_state
        self._last_snapshot_id: MutableMapping[str, int] = {}

    def apply_snapshot(self, request: AutoSaveRequest) -> AutoSaveResult:
        """Apply *request* according to the AutoSave contract."""

        session = AutoSaveSnapshotSession(
            request=request,
            flag_state=self._flag_state,
            validator=AutoSaveSnapshotValidator(
                coordinator=self._coordinator,
                telemetry=self._telemetry,
                snapshots=self._last_snapshot_id,
            ),
            audit=self._audit,
        )

        plan_result = session.plan()
        if plan_result is not None:
            return plan_result

        lock_error = session.validate_lock()
        if lock_error is not None:
            raise lock_error

        snapshot_error = session.validate_snapshot_order()
        if snapshot_error is not None:
            raise snapshot_error

        return session.commit()

    def _audit(self, action: str, request: AutoSaveRequest) -> None:
        logger.info(
            "autosave_audit action=%s project_id=%s precision_mode=%s snapshot_id=%s",
            action,
            request.project_id,
            request.precision_mode,
            request.snapshot_id,
        )


class AutoSaveSnapshotSession:
    """Encapsulate snapshot processing for a single request."""

    def __init__(
        self,
        *,
        request: AutoSaveRequest,
        flag_state: FlagState,
        validator: "AutoSaveSnapshotValidator",
        audit: Callable[[str, AutoSaveRequest], None],
    ) -> None:
        self._request = request
        self._flag_state = flag_state
        self._validator = validator
        self._audit = audit

    @property
    def request(self) -> AutoSaveRequest:
        return self._request

    def plan(self) -> Optional[AutoSaveResult]:
        """Evaluate rollout gates and return a skip result when inactive."""

        flag_enabled = self._flag_state.autosave_project_lock_enabled()
        checklist_completed = self._flag_state.autosave_rollout_checklist_completed()
        try:
            rollout_active = ensure_autosave_rollout_enabled(
                flag_enabled=flag_enabled, checklist_completed=checklist_completed
            )
        except RuntimeError as error:
            self._audit("rollout_checklist_incomplete", self._request)
            logger.warning(
                "autosave.project_lock guard skipped project %s: %s",
                self._request.project_id,
                error,
            )
            return AutoSaveResult(status="skipped", applied_snapshot_id=None, next_retry_at=None)

        if not rollout_active:
            self._audit("flag_disabled", self._request)
            logger.info(
                "autosave.project_lock disabled; skipping validation for project %s",
                self._request.project_id,
            )
            return AutoSaveResult(status="skipped", applied_snapshot_id=None, next_retry_at=None)

        return None

    def validate_lock(self) -> Optional[ProjectLockError]:
        """Return an error when Merge lock validation fails."""

        if not self._request.lock_token:
            self._audit("lock_token_missing", self._request)
            return LockTokenInvalidError("Merge did not supply a lock_token as required")

        error = self._validator.validate_lock_token(self._request)
        if error is not None:
            self._audit("lock_token_invalid", self._request)
        return error

    def validate_snapshot_order(self) -> Optional[SnapshotOrderViolation]:
        """Return an error when snapshot IDs are not strictly increasing."""

        error = self._validator.validate_snapshot_order(self._request)
        if error is not None:
            self._audit("snapshot_monotonicity_violation", self._request)
        return error

    def commit(self) -> AutoSaveResult:
        """Register the snapshot and emit telemetry for a successful commit."""

        self._validator.register_snapshot(self._request)
        self._audit("snapshot_committed", self._request)
        return AutoSaveResult(
            status="ok",
            applied_snapshot_id=self._request.snapshot_id,
            next_retry_at=None,
        )


class AutoSaveSnapshotValidator:
    """Perform lock validation and snapshot registration duties."""

    def __init__(
        self,
        *,
        coordinator: ProjectLockCoordinator,
        telemetry: TelemetryEmitter,
        snapshots: MutableMapping[str, int],
    ) -> None:
        self._coordinator = coordinator
        self._telemetry = telemetry
        self._snapshots = snapshots

    def validate_lock_token(self, request: AutoSaveRequest) -> Optional[LockTokenInvalidError]:
        if not self._coordinator.validate_token(request.project_id, request.lock_token):
            return LockTokenInvalidError("Merge supplied an invalid or expired lock_token")
        return None

    def validate_snapshot_order(self, request: AutoSaveRequest) -> Optional[SnapshotOrderViolation]:
        last_snapshot = self._snapshots.get(request.project_id)
        if last_snapshot is None or request.snapshot_id > last_snapshot:
            return None

        self._telemetry.emit(
            "autosave.rollback.triggered",
            {
                "project_id": request.project_id,
                "precision_mode": request.precision_mode,
                "last_snapshot_id": last_snapshot,
                "incoming_snapshot_id": request.snapshot_id,
            },
        )
        return SnapshotOrderViolation(
            "AutoSave snapshot IDs must be strictly increasing for each project"
        )

    def register_snapshot(self, request: AutoSaveRequest) -> None:
        self._snapshots[request.project_id] = request.snapshot_id
        payload = {
            "project_id": request.project_id,
            "snapshot_id": request.snapshot_id,
            "precision_mode": request.precision_mode,
            "timestamp": request.timestamp.isoformat(),
        }
        self._telemetry.emit("autosave.snapshot.commit", payload)

