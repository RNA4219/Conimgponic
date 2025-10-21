# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 RNA4219

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from collections import Counter
from pathlib import Path
from typing import Dict, Mapping, Sequence

CATEGORY_ALIASES: Mapping[str, str] = {
    "feature": "feature", "feat": "feature", "fix": "fix", "bugfix": "fix",
    "chore": "chore", "docs": "docs", "doc": "docs",
}
CATEGORY_LINE = re.compile(r"種別\s*:\s*(?P<value>.+)")
SPLIT_PATTERN = re.compile(r"[\s,\/]+")

def _normalise(token: str) -> str | None:
    return CATEGORY_ALIASES.get(token.strip().lower())

def _from_pr_body(pr_body: str) -> Counter[str]:
    counter: Counter[str] = Counter()
    for match in CATEGORY_LINE.finditer(pr_body):
        for token in SPLIT_PATTERN.split(match.group("value")):
            category = _normalise(token)
            if category:
                counter[category] += 1
    return counter

def _from_commits(commits: Sequence[str]) -> Counter[str]:
    counter: Counter[str] = Counter()
    for message in commits:
        head = message.splitlines()[0]
        prefix = head.split(":", 1)[0].split("(", 1)[0]
        category = _normalise(prefix)
        if category:
            counter[category] += 1
    return counter

def collect_category_metrics(pr_body: str, commit_messages: Sequence[str]) -> Dict[str, Dict[str, int]]:
    pr_counts = _from_pr_body(pr_body)
    commit_counts = _from_commits(commit_messages)
    combined = pr_counts + commit_counts
    return {
        "sources": {
            "pr_body": dict(sorted(pr_counts.items())),
            "commits": dict(sorted(commit_counts.items())),
        },
        "combined": dict(sorted(combined.items())),
    }

def write_metrics(metrics: Mapping[str, object], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(metrics, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")

def _read_pr_body(path: Path | None) -> str:
    if path:
        return path.read_text(encoding="utf-8")
    value = os.environ.get("PR_BODY", "")
    file_env = os.environ.get("PR_BODY_PATH")
    if file_env:
        file_path = Path(file_env)
        if file_path.is_file():
            return file_path.read_text(encoding="utf-8")
    return value

def _read_commits(path: Path | None) -> list[str]:
    if path:
        return [line for line in path.read_text(encoding="utf-8").splitlines() if line]
    value = os.environ.get("COMMIT_MESSAGES", "")
    file_env = os.environ.get("COMMIT_MESSAGES_PATH")
    if file_env:
        file_path = Path(file_env)
        if file_path.is_file():
            return [line for line in file_path.read_text(encoding="utf-8").splitlines() if line]
    if value:
        return [line for line in value.splitlines() if line]
    result = subprocess.run(["git", "log", "-1", "--pretty=%s"], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        return []
    line = result.stdout.strip()
    return [line] if line else []

def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Aggregate INT metrics from PR body and recent commits.")
    parser.add_argument("--pr-body", type=Path, help="Path to the pull request body text.")
    parser.add_argument("--commit-log", type=Path, help="Path to newline-delimited commit messages.")
    parser.add_argument("--output", type=Path, default=Path("tools/ci/int-metrics.json"))
    args = parser.parse_args(argv)
    pr_body = _read_pr_body(args.pr_body)
    commits = _read_commits(args.commit_log)
    metrics = collect_category_metrics(pr_body, commits)
    write_metrics(metrics, args.output)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
