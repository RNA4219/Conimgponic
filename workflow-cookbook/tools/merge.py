"""Backward-compatible merge module exports."""

from tools.merge.orchestrator import MergeAutosaveOrchestrator

from tools.merge.precision_mode_pipeline import (  # noqa: F401
    MergeExecutionResult,
    MergeOperation,
    MergePipeline,
    MergePipelineRequest,
    MergePipelineResult,
)

__all__ = [
    "MergeAutosaveOrchestrator",
    "MergeExecutionResult",
    "MergeOperation",
    "MergePipeline",
    "MergePipelineRequest",
    "MergePipelineResult",
]

