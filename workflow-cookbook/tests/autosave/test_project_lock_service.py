"""AutoSave project lock integration tests.

This suite follows docs/tasks/task-autosave-project-locks.md TDD guidance to
validate the AutoSave I/O contract and Merge lock coordination requirements.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List

import pytest

from tools.autosave.project_lock_service import (
    AutoSaveRequest,
    AutoSaveSnapshotSession,
    AutoSaveSnapshotValidator,
    LockTokenInvalidError,
    SnapshotOrderViolation,
    StaticFlagState,
    TelemetryEmitter,
    ProjectLockCoordinator,
    ProjectLockService,
)
from tools.merge import MergeAutosaveOrchestrator


class StubTelemetry(TelemetryEmitter):
    def __init__(self) -> None:
        self.events: List[tuple[str, Dict[str, Any]]] = []

    def emit(self, event: str, payload: Dict[str, Any]) -> None:  # type: ignore[override]
        self.events.append((event, payload))


class StubCoordinator(ProjectLockCoordinator):
    def __init__(self) -> None:
        self._valid_tokens: Dict[str, str] = {}
        self.release_events: List[tuple[str, str]] = []
        self._attempts: Dict[tuple[str, str], int] = defaultdict(int)

    def set_token(self, project_id: str, token: str) -> None:
        self._valid_tokens[project_id] = token

    def validate_token(self, project_id: str, token: str) -> bool:
        key = (project_id, token)
        self._attempts[key] += 1
        return self._valid_tokens.get(project_id) == token

    def lock_release(self, project_id: str, token: str) -> None:
        self.release_events.append((project_id, token))

    # Helper to simulate transient validation failures.
    def invalidate_once(self, project_id: str, token: str) -> None:
        key = (project_id, token)
        self._attempts[key] = 0

        def _wrapper(pid: str, tkn: str) -> bool:
            local_key = (pid, tkn)
            self._attempts[local_key] += 1
            if self._attempts[local_key] == 1:
                return False
            return self._valid_tokens.get(pid) == tkn

        self.validate_token = _wrapper  # type: ignore[assignment]


class MutableFlagState(StaticFlagState):
    def __init__(
        self,
        autosave_project_lock: bool = True,
        precision_mode: str = "strict",
        checklist_completed: bool = True,
    ) -> None:
        self._autosave = autosave_project_lock
        self._precision_mode = precision_mode
        self._checklist_completed = checklist_completed

    def autosave_project_lock_enabled(self) -> bool:
        return self._autosave

    def merge_precision_mode(self) -> str:
        return self._precision_mode

    def set_autosave(self, value: bool) -> None:
        self._autosave = value

    def set_precision_mode(self, value: str) -> None:
        self._precision_mode = value

    def autosave_rollout_checklist_completed(self) -> bool:
        return self._checklist_completed

    def set_checklist(self, value: bool) -> None:
        self._checklist_completed = value


@pytest.fixture
def service_components() -> tuple[ProjectLockService, StubCoordinator, StubTelemetry, MutableFlagState]:
    telemetry = StubTelemetry()
    coordinator = StubCoordinator()
    flags = MutableFlagState()
    service = ProjectLockService(coordinator=coordinator, telemetry=telemetry, flag_state=flags)
    return service, coordinator, telemetry, flags


def _request(project_id: str = "project-1", snapshot_id: int = 1, token: str = "lock-1") -> AutoSaveRequest:
    return AutoSaveRequest(
        project_id=project_id,
        snapshot_delta={"key": "value"},
        lock_token=token,
        snapshot_id=snapshot_id,
        timestamp=datetime.now(tz=timezone.utc),
        precision_mode="strict",
    )


def test_lock_token_validation_requires_merge_token(service_components: tuple[ProjectLockService, StubCoordinator, StubTelemetry, MutableFlagState]) -> None:
    service, coordinator, telemetry, _ = service_components
    coordinator.set_token("project-1", "lock-expected")
    with pytest.raises(LockTokenInvalidError):
        service.apply_snapshot(_request(token="lock-mismatch"))
    assert telemetry.events == []


def test_snapshot_session_plan_handles_disabled_flag(
    service_components: tuple[ProjectLockService, StubCoordinator, StubTelemetry, MutableFlagState]
) -> None:
    service, coordinator, telemetry, flags = service_components
    flags.set_autosave(False)
    session = AutoSaveSnapshotSession(
        request=_request(),
        flag_state=flags,
        validator=AutoSaveSnapshotValidator(
            coordinator=coordinator,
            telemetry=telemetry,
            snapshots=service._last_snapshot_id,  # type: ignore[attr-defined]
        ),
        audit=service._audit,  # type: ignore[attr-defined]
    )
    plan_result = session.plan()
    assert plan_result is not None
    assert plan_result.status == "skipped"
    assert telemetry.events == []


def test_snapshot_session_plan_handles_incomplete_checklist(
    service_components: tuple[ProjectLockService, StubCoordinator, StubTelemetry, MutableFlagState]
) -> None:
    service, coordinator, telemetry, flags = service_components
    flags.set_checklist(False)
    session = AutoSaveSnapshotSession(
        request=_request(),
        flag_state=flags,
        validator=AutoSaveSnapshotValidator(
            coordinator=coordinator,
            telemetry=telemetry,
            snapshots=service._last_snapshot_id,  # type: ignore[attr-defined]
        ),
        audit=service._audit,  # type: ignore[attr-defined]
    )
    plan_result = session.plan()
    assert plan_result is not None
    assert plan_result.status == "skipped"
    assert telemetry.events == []


def test_snapshot_validator_detects_monotonicity_violation(
    service_components: tuple[ProjectLockService, StubCoordinator, StubTelemetry, MutableFlagState]
) -> None:
    service, coordinator, telemetry, flags = service_components
    coordinator.set_token("project-1", "lock-1")
    service._last_snapshot_id["project-1"] = 10  # type: ignore[attr-defined]
    session = AutoSaveSnapshotSession(
        request=_request(snapshot_id=9),
        flag_state=flags,
        validator=AutoSaveSnapshotValidator(
            coordinator=coordinator,
            telemetry=telemetry,
            snapshots=service._last_snapshot_id,  # type: ignore[attr-defined]
        ),
        audit=service._audit,  # type: ignore[attr-defined]
    )
    validation_error = session.validate_snapshot_order()
    assert isinstance(validation_error, SnapshotOrderViolation)
    assert any(event == "autosave.rollback.triggered" for event, _ in telemetry.events)


def test_snapshot_monotonicity_triggers_rollback_telemetry(service_components: tuple[ProjectLockService, StubCoordinator, StubTelemetry, MutableFlagState]) -> None:
    service, coordinator, telemetry, _ = service_components
    coordinator.set_token("project-1", "lock-1")
    service.apply_snapshot(_request(snapshot_id=10))
    assert telemetry.events[0][0] == "autosave.snapshot.commit"
    with pytest.raises(SnapshotOrderViolation):
        service.apply_snapshot(_request(snapshot_id=9))
    assert any(event == "autosave.rollback.triggered" for event, _ in telemetry.events)


def test_merge_orchestrator_retries_and_releases_on_strict_precision_mode(service_components: tuple[ProjectLockService, StubCoordinator, StubTelemetry, MutableFlagState]) -> None:
    service, coordinator, telemetry, flags = service_components
    coordinator.set_token("project-1", "lock-1")
    coordinator.invalidate_once("project-1", "lock-1")
    orchestrator = MergeAutosaveOrchestrator(service=service, coordinator=coordinator, flag_state=flags)
    result = orchestrator.commit_with_retry(_request())
    assert result.status == "ok"
    assert coordinator.release_events == [("project-1", "lock-1")]
    assert any(event == "autosave.snapshot.commit" for event, _ in telemetry.events)


def test_flag_rollout_guard_enforces_checklist_before_enable(
    service_components: tuple[
        ProjectLockService, StubCoordinator, StubTelemetry, MutableFlagState
    ],
    caplog: pytest.LogCaptureFixture,
) -> None:
    service, coordinator, telemetry, flags = service_components
    coordinator.set_token("project-1", "lock-1")

    flags.set_autosave(False)
    caplog.clear()
    with caplog.at_level(logging.INFO):
        result = service.apply_snapshot(_request())
    assert result.status == "skipped"
    assert any("action=flag_disabled" in record.message for record in caplog.records)

    flags.set_autosave(True)
    flags.set_checklist(False)
    telemetry.events.clear()
    caplog.clear()
    with caplog.at_level(logging.INFO):
        result = service.apply_snapshot(_request(snapshot_id=1))
    assert result.status == "skipped"
    assert telemetry.events == []
    assert any(
        "action=rollout_checklist_incomplete" in record.message for record in caplog.records
    )

    flags.set_checklist(True)
    telemetry.events.clear()
    result = service.apply_snapshot(_request(snapshot_id=1))
    assert result.status == "ok"
    assert telemetry.events[-1][0] == "autosave.snapshot.commit"

    flags.set_autosave(False)
    telemetry.events.clear()
    caplog.clear()
    with caplog.at_level(logging.INFO):
        result = service.apply_snapshot(_request(snapshot_id=2))
    assert result.status == "skipped"
    assert telemetry.events == []
    assert any("action=flag_disabled" in record.message for record in caplog.records)

