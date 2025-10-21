# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 RNA4219

from __future__ import annotations

import os
import runpy
import sys
from pathlib import Path
from typing import Sequence


_SAMPLE_FLAG = "--use-sample-pr-body"
_SAMPLE_RELATIVE_PATH = Path("workflow-cookbook") / "tools" / "ci" / "fixtures" / "sample_pr_body.md"
_PR_EVENT_NAMES = {"pull_request", "pull_request_target"}


def _prepare_arguments(argv: Sequence[str] | None) -> tuple[list[str], bool]:
    if argv is None:
        argv = sys.argv[1:]
    filtered: list[str] = []
    use_sample = False
    for argument in argv:
        if argument == _SAMPLE_FLAG:
            use_sample = True
            continue
        filtered.append(argument)
    return filtered, use_sample


def _load_sample_body(sample_path: Path) -> str:
    return sample_path.read_text(encoding="utf-8")


def _should_use_sample(use_sample_flag: bool) -> bool:
    if use_sample_flag:
        return True
    if os.environ.get("PR_BODY"):
        return False
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    if not event_path:
        return True
    event_name = os.environ.get("GITHUB_EVENT_NAME")
    if event_name not in _PR_EVENT_NAMES:
        return True
    return False


def main(argv: Sequence[str] | None = None) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    legacy_script = repo_root / "workflow-cookbook" / "tools" / "ci" / "check_governance_gate.py"
    if not legacy_script.is_file():
        raise FileNotFoundError(legacy_script)

    filtered_args, use_sample_flag = _prepare_arguments(argv)

    if _should_use_sample(use_sample_flag):
        sample_path = repo_root / _SAMPLE_RELATIVE_PATH
        if not sample_path.is_file():
            raise FileNotFoundError(sample_path)
        os.environ.setdefault("PR_BODY", _load_sample_body(sample_path))
        os.environ.pop("GITHUB_EVENT_PATH", None)

    original_argv = sys.argv
    try:
        sys.argv = [str(legacy_script), *filtered_args]
        runpy.run_path(str(legacy_script), run_name="__main__")
    finally:
        sys.argv = original_argv


if __name__ == "__main__":
    main()
