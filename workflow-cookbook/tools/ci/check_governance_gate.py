# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 RNA4219

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Iterator, List, Sequence, TextIO, Tuple


_REPO_ROOT = Path(__file__).resolve().parents[2]


def get_changed_paths(refspec: str) -> List[str]:
    result = subprocess.run(
        ["git", "diff", "--name-only", refspec],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=_REPO_ROOT,
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
        return None
    return path.read_text(encoding="utf-8")


@dataclass
class ResolutionResult:
    body: str | None
    errors: list[str] = field(default_factory=list)

    @property
    def is_success(self) -> bool:
        return self.body is not None

    @property
    def combined_error_message(self) -> str:
        return "\n".join(self.errors)

    def emit_errors(self, *, stream: TextIO | None = None) -> None:
        if not self.errors:
            return
        target = sys.stderr if stream is None else stream
        print(self.combined_error_message, file=target)


class PRBodyResolver:
    def __init__(
        self,
        *,
        env_getter: Callable[[str], str | None] | None = None,
        path_reader: Callable[[Path], str | None] | None = None,
        event_reader: Callable[[Path], str | None] | None = None,
    ) -> None:
        self._env_getter = env_getter or os.environ.get
        self._path_reader = path_reader or read_pr_body_from_path
        self._event_reader = event_reader or read_event_body

    def resolve(
        self,
        *,
        cli_body: str | None = None,
        cli_body_path: Path | None = None,
    ) -> ResolutionResult:
        if cli_body is not None:
            return ResolutionResult(body=cli_body)

        errors: list[str] = []

        if cli_body_path is not None:
            body_from_cli_path = self._path_reader(cli_body_path)
            if body_from_cli_path is not None:
                return ResolutionResult(body=body_from_cli_path)
            errors.append(f"PR body file not found: {cli_body_path}")

        direct_body = self._env_getter("PR_BODY")
        if direct_body is not None:
            return ResolutionResult(body=direct_body)

        env_body_path_value = self._env_getter("PR_BODY_PATH")
        if env_body_path_value:
            env_body_path = Path(env_body_path_value)
            body_from_env_path = self._path_reader(env_body_path)
            if body_from_env_path is not None:
                return ResolutionResult(body=body_from_env_path)
            errors.append(f"PR body file not found: {env_body_path}")

        event_path_value = self._env_getter("GITHUB_EVENT_PATH")
        if event_path_value:
            body_from_event = self._event_reader(Path(event_path_value))
            if body_from_event is not None:
                return ResolutionResult(body=body_from_event)

        errors.append("PR body data is unavailable. Set PR_BODY or GITHUB_EVENT_PATH.")
        return ResolutionResult(body=None, errors=errors)


def resolve_pr_body(
    *, cli_body: str | None = None, cli_body_path: Path | None = None
) -> str | None:
    resolver = PRBodyResolver()
    result = resolver.resolve(cli_body=cli_body, cli_body_path=cli_body_path)
    if not result.is_success:
        result.emit_errors()
        return None
    return result.body


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


class CategoryHintResolver:
    def __init__(
        self,
        *,
        env_getter: Callable[[str], str | None] | None = None,
        changed_paths_provider: Callable[[str], Sequence[str]] | None = None,
        fallback_refspec: str = "HEAD^..HEAD",
    ) -> None:
        self._env_getter = env_getter or os.environ.get
        self._changed_paths_provider = changed_paths_provider or get_changed_paths
        self._fallback_refspec = fallback_refspec

    def resolve(
        self,
        *,
        base_ref: str | None = None,
        head_ref: str = "HEAD",
        fallback_refspec: str | None = None,
    ) -> List[str]:
        resolved_base = (base_ref or self._env_getter("GITHUB_BASE_REF") or "").strip()
        effective_fallback = fallback_refspec or self._fallback_refspec

        refspec_candidates: list[str] = []
        if resolved_base:
            base_spec = resolved_base
            if not base_spec.startswith("origin/"):
                base_spec = f"origin/{base_spec}"
            refspec_candidates.append(f"{base_spec}...{head_ref}")
        refspec_candidates.append(effective_fallback)

        last_index = len(refspec_candidates) - 1
        for index, refspec in enumerate(refspec_candidates):
            try:
                changed_paths = self._changed_paths_provider(refspec)
            except subprocess.CalledProcessError:
                continue
            hints = infer_categories_from_paths(changed_paths)
            if hints or index == last_index:
                return hints

        return []


def collect_recent_category_hints(
    *,
    base_ref: str | None = None,
    head_ref: str = "HEAD",
    fallback_refspec: str = "HEAD^..HEAD",
) -> List[str]:
    resolver = CategoryHintResolver()
    return resolver.resolve(
        base_ref=base_ref,
        head_ref=head_ref,
        fallback_refspec=fallback_refspec,
    )


@dataclass
class ValidationOutcome:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    _messages: list[Tuple[str, str]] = field(default_factory=list, repr=False)

    @property
    def is_success(self) -> bool:
        return not self.errors

    def add_error(self, message: str) -> None:
        self.errors.append(message)
        self._messages.append(("error", message))

    def add_warning(self, message: str) -> None:
        self.warnings.append(message)
        self._messages.append(("warning", message))

    def iter_messages(self) -> Iterator[Tuple[str, str]]:
        return iter(self._messages)

    def emit(self, *, stream: TextIO = sys.stderr) -> None:
        for _, message in self._messages:
            print(message, file=stream)


class ValidationRule(ABC):
    @abstractmethod
    def evaluate(self, context: ValidationContext, outcome: ValidationOutcome) -> None:
        raise NotImplementedError()


@dataclass
class ValidationContext:
    body: str
    category_hints: Sequence[str] | None = None
    hint_resolver: Callable[[], Sequence[str] | None] | None = None
    intent_present: bool = field(init=False, default=False)

    def __post_init__(self) -> None:
        self.body = self.body or ""
        self._resolved_hints: list[str] | None = None

    @property
    def normalized_body(self) -> str:
        return self.body

    def resolve_category_hints(self) -> list[str]:
        if self._resolved_hints is None:
            if self.category_hints is not None:
                hints: Sequence[str] | None = self.category_hints
            else:
                resolver = self.hint_resolver or collect_recent_category_hints
                hints = resolver() or []
            self._resolved_hints = [hint for hint in hints if hint]
        return list(self._resolved_hints)


class IntentPresenceRule(ValidationRule):
    def evaluate(self, context: ValidationContext, outcome: ValidationOutcome) -> None:
        has_intent = bool(INTENT_PATTERN.search(context.normalized_body))
        context.intent_present = has_intent
        if not has_intent:
            outcome.add_error("PR body must include 'Intent: INT-xxx'")


class IntentCategoryRule(ValidationRule):
    def evaluate(self, context: ValidationContext, outcome: ValidationOutcome) -> None:
        if not context.intent_present:
            return

        normalized_body = context.normalized_body
        category_matches = list(INTENT_CATEGORY_PATTERN.findall(normalized_body))
        if category_matches:
            for _, raw_category in category_matches:
                category = raw_category.upper()
                if category not in ALLOWED_INTENT_CATEGORIES:
                    allowed = ", ".join(sorted(ALLOWED_INTENT_CATEGORIES))
                    outcome.add_error(
                        f"Intent category '{category}' is not allowed. Allowed categories: {allowed}."
                    )
            return

        base_ids = {match.upper() for match in INTENT_ID_PATTERN.findall(normalized_body)}
        intent_reference = ", ".join(sorted(base_ids)) or "INT-???"
        hints = context.resolve_category_hints()
        if hints:
            suggestion = ", ".join(hints)
            message = (
                "No intent category pattern (INT-###-CAT-) detected for"
                f" {intent_reference}. Consider categories: {suggestion}."
            )
        else:
            message = (
                "No intent category pattern (INT-###-CAT-) detected and unable"
                " to infer category from recent changes."
            )
        outcome.add_warning(message)


class EvaluationReferenceRule(ValidationRule):
    def evaluate(self, context: ValidationContext, outcome: ValidationOutcome) -> None:
        normalized_body = context.normalized_body
        has_evaluation_heading = bool(EVALUATION_HEADING_PATTERN.search(normalized_body))
        has_evaluation_anchor = bool(EVALUATION_ANCHOR_PATTERN.search(normalized_body))
        if not (has_evaluation_heading or has_evaluation_anchor):
            outcome.add_error("PR must reference EVALUATION (acceptance) anchor")


class PriorityScoreRule(ValidationRule):
    def evaluate(self, context: ValidationContext, outcome: ValidationOutcome) -> None:
        if not PRIORITY_PATTERN.search(context.normalized_body):
            outcome.add_warning(
                "Consider adding 'Priority Score: <number>' based on prioritization.yaml"
            )


DEFAULT_VALIDATION_RULES: tuple[ValidationRule, ...] = (
    IntentPresenceRule(),
    IntentCategoryRule(),
    EvaluationReferenceRule(),
    PriorityScoreRule(),
)


class PRBodyValidator:
    def __init__(self, rules: Sequence[ValidationRule] | None = None) -> None:
        if rules is None:
            rules = DEFAULT_VALIDATION_RULES
        self._rules = list(rules)

    def validate(self, context: ValidationContext) -> ValidationOutcome:
        outcome = ValidationOutcome()
        for rule in self._rules:
            rule.evaluate(context, outcome)
        return outcome


def collect_validation_outcome(
    body: str | None,
    *,
    category_hints: Sequence[str] | None = None,
    hint_resolver: Callable[[], Sequence[str] | None] | None = None,
) -> ValidationOutcome:
    validator = PRBodyValidator()
    context = ValidationContext(
        body=body or "",
        category_hints=category_hints,
        hint_resolver=hint_resolver,
    )
    return validator.validate(context)


def validate_pr_body(
    body: str | None,
    *,
    category_hints: Sequence[str] | None = None,
    hint_resolver: Callable[[], Sequence[str] | None] | None = None,
) -> bool:
    outcome = collect_validation_outcome(
        body,
        category_hints=category_hints,
        hint_resolver=hint_resolver,
    )
    outcome.emit(stream=sys.stderr)
    return outcome.is_success


def parse_arguments(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run governance gate checks")
    parser.add_argument("--pr-body", help="PR本文を直接指定")
    parser.add_argument(
        "--pr-body-path",
        type=Path,
        help="PR本文が含まれるファイルパスを指定",
    )
    return parser.parse_args(list(argv))


def main(
    argv: Sequence[str] | None = None,
    *,
    category_hints: Sequence[str] | None = None,
    hint_resolver: Callable[[], Sequence[str] | None] | None = None,
) -> int:
    args = parse_arguments(argv or ())
    resolver = PRBodyResolver()
    resolution = resolver.resolve(
        cli_body=args.pr_body,
        cli_body_path=args.pr_body_path,
    )
    if not resolution.is_success:
        resolution.emit_errors(stream=sys.stderr)
        return 1
    body = resolution.body
    assert body is not None

    outcome = collect_validation_outcome(
        body,
        category_hints=category_hints,
        hint_resolver=hint_resolver,
    )
    outcome.emit(stream=sys.stderr)
    if not outcome.is_success:
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main(tuple(sys.argv[1:])))
