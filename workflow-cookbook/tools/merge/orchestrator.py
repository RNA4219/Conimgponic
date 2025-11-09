"""Merge orchestration entrypoint for AutoSave lock coordination."""

from __future__ import annotations

from typing import Optional

from tools.autosave.project_lock_service import (
    AutoSaveRequest,
    AutoSaveResult,
    FlagState,
    LockTokenInvalidError,
    ProjectLockCoordinator,
    ProjectLockService,
    SnapshotOrderViolation,
)


class MergeAutosaveOrchestrator:
    """Integrate Merge precision modes with the AutoSave lock service."""

    def __init__(
        self,
        *,
        service: ProjectLockService,
        coordinator: ProjectLockCoordinator,
        flag_state: FlagState,
    ) -> None:
        self._service = service
        self._coordinator = coordinator
        self._flag_state = flag_state

    def commit_with_retry(self, request: AutoSaveRequest) -> AutoSaveResult:
        """Commit *request* retrying per ``merge.precision_mode``."""

        precision_mode = self._flag_state.merge_precision_mode()
        max_attempts = 2 if precision_mode == "strict" else 1
        last_error: Optional[LockTokenInvalidError] = None
        for attempt in range(max_attempts):
            try:
                result = self._service.apply_snapshot(request)
                self._coordinator.lock_release(request.project_id, request.lock_token)
                return result
            except LockTokenInvalidError as error:
                last_error = error
                if attempt + 1 == max_attempts:
                    raise
            except SnapshotOrderViolation:
                self._coordinator.lock_release(request.project_id, request.lock_token)
                raise
        assert last_error is not None
        raise last_error

