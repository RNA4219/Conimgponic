# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 RNA4219

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Iterable, List, Sequence


def get_changed_paths(refspec: str) -> List[str]:
    result = subprocess.run(
        ["git", "diff", "--name-only", refspec],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def read_event_body(event_path: Path) -> str | None:
    if not event_path.exists():
        return None
    payload = json.loads(event_path.read_text(encoding="utf-8"))
    pull_request = payload.get("pull_request")
    if not isinstance(pull_request, dict):
        return None
    body = pull_request.get("body")
    if body is None:
        return None
    if not isinstance(body, str):
        return None
    return body


def read_pr_body_from_path(path: Path) -> str | None:
    if not path.exists():
        print(f"PR body file not found: {path}", file=sys.stderr)
        return None
    return path.read_text(encoding="utf-8")


def resolve_pr_body(
    *, cli_body: str | None = None, cli_body_path: Path | None = None
) -> str | None:
    if cli_body is not None:
        return cli_body

    if cli_body_path is not None:
        return read_pr_body_from_path(cli_body_path)

    direct_body = os.environ.get("PR_BODY")
    if direct_body is not None:
        return direct_body

    env_body_path_value = os.environ.get("PR_BODY_PATH")
    if env_body_path_value:
        body_from_path = read_pr_body_from_path(Path(env_body_path_value))
        if body_from_path is not None:
            return body_from_path
        return None

    event_path_value = os.environ.get("GITHUB_EVENT_PATH")
    if not event_path_value:
        print(
            "PR body data is unavailable. Set PR_BODY or GITHUB_EVENT_PATH.",
            file=sys.stderr,
        )
        return None

    return read_event_body(Path(event_path_value))


INTENT_PATTERN = re.compile(
    r"Intent\s*[：:]\s*INT-[0-9A-Z]+(?:-[0-9A-Z]+)*",
    re.IGNORECASE,
)
INTENT_CATEGORY_PATTERN = re.compile(r"INT-(\d{3,6})-([A-Z]{2,10})-", re.IGNORECASE)
INTENT_ID_PATTERN = re.compile(r"(INT-\d{3,6})", re.IGNORECASE)
EVALUATION_HEADING_PATTERN = re.compile(
    r"^#{2,6}\s*EVALUATION\b",
    re.IGNORECASE | re.MULTILINE,
)
EVALUATION_ANCHOR_PATTERN = re.compile(
    r"(?:EVALUATION\.md)?#acceptance-criteria",
    re.IGNORECASE,
)
PRIORITY_PATTERN = re.compile(r"Priority\s*Score\s*:\s*\d+(?:\.\d+)?", re.IGNORECASE)

ALLOWED_INTENT_CATEGORIES = {
    "OPS",
    "SEC",
    "PLAT",
    "APP",
    "QA",
    "DOCS",
}

PATH_CATEGORY_HINTS = {
    "ops": "OPS",
    "runbook": "OPS",
    "security": "SEC",
    "sec": "SEC",
    "platform": "PLAT",
    "infra": "PLAT",
    "app": "APP",
    "frontend": "APP",
    "qa": "QA",
    "test": "QA",
    "docs": "DOCS",
    "documentation": "DOCS",
}


def infer_categories_from_paths(paths: Iterable[str]) -> List[str]:
    suggestions: list[str] = []
    for path in paths:
        normalized_path = path.strip().lstrip("./")
        if not normalized_path:
            continue
        segments = re.split(r"[/_.-]+", normalized_path)
        for segment in segments:
            hint = PATH_CATEGORY_HINTS.get(segment.lower())
            if hint and hint not in suggestions:
                suggestions.append(hint)
    return suggestions


def collect_recent_category_hints() -> List[str]:
    try:
        changed_paths = get_changed_paths("HEAD^..HEAD")
    except subprocess.CalledProcessError:
        return []
    return infer_categories_from_paths(changed_paths)


def validate_pr_body(body: str | None) -> bool:
    normalized_body = body or ""
    success = True

    if not INTENT_PATTERN.search(normalized_body):
        print("PR body must include 'Intent: INT-xxx'", file=sys.stderr)
        success = False
    else:
        category_matches = list(INTENT_CATEGORY_PATTERN.findall(normalized_body))
        if category_matches:
            for _, raw_category in category_matches:
                category = raw_category.upper()
                if category not in ALLOWED_INTENT_CATEGORIES:
                    print(
                        f"Intent category '{category}' is not allowed."
                        f" Allowed categories: {', '.join(sorted(ALLOWED_INTENT_CATEGORIES))}.",
                        file=sys.stderr,
                    )
                    success = False
        else:
            base_ids = {match.upper() for match in INTENT_ID_PATTERN.findall(normalized_body)}
            intent_reference = ", ".join(sorted(base_ids)) or "INT-???"
            hints = collect_recent_category_hints()
            if hints:
                suggestion = ", ".join(hints)
                print(
                    "No intent category pattern (INT-###-CAT-) detected for"
                    f" {intent_reference}. Consider categories: {suggestion}.",
                    file=sys.stderr,
                )
            else:
                print(
                    "No intent category pattern (INT-###-CAT-) detected and unable"
                    " to infer category from recent changes.",
                    file=sys.stderr,
                )

    has_evaluation_heading = bool(EVALUATION_HEADING_PATTERN.search(normalized_body))
    has_evaluation_anchor = bool(EVALUATION_ANCHOR_PATTERN.search(normalized_body))
    has_evaluation_reference = has_evaluation_heading or has_evaluation_anchor
    if not has_evaluation_reference:
        print("PR must reference EVALUATION (acceptance) anchor", file=sys.stderr)
        success = False
    if not PRIORITY_PATTERN.search(normalized_body):
        print(
            "Consider adding 'Priority Score: <number>' based on prioritization.yaml",
            file=sys.stderr,
        )

    return success


def parse_arguments(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run governance gate checks")
    parser.add_argument("--pr-body", help="PR本文を直接指定")
    parser.add_argument(
        "--pr-body-path",
        type=Path,
        help="PR本文が含まれるファイルパスを指定",
    )
    return parser.parse_args(list(argv))


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_arguments(argv or ())
    body = resolve_pr_body(
        cli_body=args.pr_body,
        cli_body_path=args.pr_body_path,
    )
    if body is None:
        return 1
    if not validate_pr_body(body):
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main(tuple(sys.argv[1:])))
