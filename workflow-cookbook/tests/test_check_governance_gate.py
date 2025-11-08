import io
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.append(str(Path(__file__).resolve().parents[1]))

from tools.ci import check_governance_gate
from tools.ci.check_governance_gate import (
    CategoryHintResolver,
    EvaluationReferenceRule,
    IntentCategoryRule,
    IntentPresenceRule,
    PRBodyResolver,
    PRBodyValidator,
    PriorityScoreRule,
    ResolutionResult,
    ValidationContext,
    validate_pr_body,
)


def _run_rules(
    body: str,
    rules: list[check_governance_gate.ValidationRule],
    *,
    category_hints: list[str] | None = None,
) -> check_governance_gate.ValidationOutcome:
    context = ValidationContext(
        body=body,
        category_hints=category_hints,
    )
    validator = PRBodyValidator(rules)
    return validator.validate(context)


def test_intent_presence_rule_requires_intent():
    outcome = _run_rules("", [IntentPresenceRule()])

    expected = "PR body must include 'Intent: INT-xxx'"
    assert outcome.errors == [expected]
    assert list(outcome.iter_messages()) == [("error", expected)]


def test_intent_category_rule_prefers_hints():
    body = "Intent: INT-4242"
    rules = [IntentPresenceRule(), IntentCategoryRule()]

    outcome = _run_rules(body, rules, category_hints=["OPS", "QA"])

    expected = (
        "warning",
        "No intent category pattern (INT-###-CAT-) detected for INT-4242. Consider categories: OPS, QA.",
    )
    assert outcome.errors == []
    assert outcome.warnings == [expected[1]]
    assert list(outcome.iter_messages()) == [expected]


def test_intent_category_rule_blocks_unknown_category():
    body = "Intent: INT-4242-UNKNOWN-Test"
    rules = [IntentPresenceRule(), IntentCategoryRule()]

    outcome = _run_rules(body, rules)

    expected = (
        "error",
        "Intent category 'UNKNOWN' is not allowed. Allowed categories: APP, DOCS, OPS, PLAT, QA, SEC.",
    )
    assert outcome.errors == [expected[1]]
    assert outcome.warnings == []
    assert list(outcome.iter_messages()) == [expected]


def test_evaluation_reference_rule_requires_anchor():
    body = "Intent: INT-999-OPS-Test"
    rules = [IntentPresenceRule(), EvaluationReferenceRule()]

    outcome = _run_rules(body, rules)

    expected = (
        "error",
        "PR must reference EVALUATION (acceptance) anchor",
    )
    assert outcome.errors == [expected[1]]
    assert list(outcome.iter_messages()) == [expected]


def test_priority_score_rule_warns_when_missing():
    body = """Intent: INT-999-OPS-Test
## EVALUATION
- [Acceptance Criteria](../EVALUATION.md#acceptance-criteria)
"""
    rules = [IntentPresenceRule(), PriorityScoreRule()]

    outcome = _run_rules(body, rules)

    expected = (
        "warning",
        "Consider adding 'Priority Score: <number>' based on prioritization.yaml",
    )
    assert outcome.warnings == [expected[1]]
    assert list(outcome.iter_messages()) == [expected]


def test_get_changed_paths_uses_repo_root(monkeypatch):
    captured = {}

    def _fake_run(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs

        class _Result:
            stdout = "foo.txt\n"

        return _Result()

    monkeypatch.setattr(check_governance_gate.subprocess, "run", _fake_run)

    result = check_governance_gate.get_changed_paths("main..HEAD")

    assert result == ["foo.txt"]
    assert captured["kwargs"]["cwd"] == check_governance_gate._REPO_ROOT


def test_validate_pr_body_success(capsys):
    body = """
Intent: INT-123-OPS-Migrate
## EVALUATION
- [Acceptance Criteria](../EVALUATION.md#acceptance-criteria)
Priority Score: 4.5 / 安全性強化
"""

    assert validate_pr_body(body) is True
    captured = capsys.readouterr()
    assert captured.err == ""


def test_validate_pr_body_accepts_fullwidth_colon(capsys):
    body = """
Intent：INT-456-SEC-Audit
## EVALUATION
- [Acceptance Criteria](../EVALUATION.md#acceptance-criteria)
Priority Score: 1
"""

    assert validate_pr_body(body) is True
    captured = capsys.readouterr()
    assert captured.err == ""


def test_validate_pr_body_accepts_local_evaluation_anchor(capsys):
    body = """
Intent: INT-900-PLAT-Refactor
## EVALUATION
- [Acceptance Criteria](#acceptance-criteria)
Priority Score: 5
"""

    assert validate_pr_body(body) is True
    captured = capsys.readouterr()
    assert captured.err == ""


def test_validate_pr_body_missing_intent(capsys):
    body = """
## EVALUATION
- [Acceptance Criteria](../EVALUATION.md#acceptance-criteria)
Priority Score: 2
"""

    assert validate_pr_body(body) is False
    captured = capsys.readouterr()
    assert "PR body must include 'Intent: INT-xxx'" in captured.err


def test_validate_pr_body_missing_evaluation(capsys):
    body = """
Intent: INT-001-OPS-Rollout
Priority Score: 3
"""

    assert validate_pr_body(body) is False
    captured = capsys.readouterr()
    assert "PR must reference EVALUATION (acceptance) anchor" in captured.err


def test_validate_pr_body_missing_evaluation_anchor(capsys):
    body = """
Intent: INT-001-OPS-Rollout
## EVALUATION
"""

    assert validate_pr_body(body) is True
    captured = capsys.readouterr()
    assert "Consider adding 'Priority Score: <number>'" in captured.err


def test_validate_pr_body_requires_evaluation_heading(capsys):
    body = """
Intent: INT-555-OPS-Plan
- [Acceptance Criteria](../EVALUATION.md#acceptance-criteria)
Evaluation anchor is explained here without heading.
"""

    assert validate_pr_body(body) is True
    captured = capsys.readouterr()
    assert "Consider adding 'Priority Score: <number>'" in captured.err


def test_validate_pr_body_warns_without_priority_score(capsys):
    body = """
Intent: INT-789-OPS-Rollout
## EVALUATION
- [Acceptance Criteria](../EVALUATION.md#acceptance-criteria)
"""

    assert validate_pr_body(body) is True
    captured = capsys.readouterr()
    assert "Consider adding 'Priority Score: <number>'" in captured.err


def test_validate_pr_body_rejects_unknown_intent_category(capsys):
    body = """
Intent: INT-777-UNKNOWN-Test
## EVALUATION
- [Acceptance Criteria](../EVALUATION.md#acceptance-criteria)
Priority Score: 2
"""

    assert validate_pr_body(body) is False
    captured = capsys.readouterr()
    assert "Intent category 'UNKNOWN' is not allowed" in captured.err


def test_validate_pr_body_warns_when_category_missing(monkeypatch, capsys):
    monkeypatch.setattr(
        check_governance_gate,
        "get_changed_paths",
        lambda refspec: ["ops/runbook.md", "docs/guide.md"] if refspec == "HEAD^..HEAD" else [],
    )

    body = """
Intent: INT-4242
## EVALUATION
- [Acceptance Criteria](../EVALUATION.md#acceptance-criteria)
Priority Score: 2
"""

    assert validate_pr_body(body) is True
    captured = capsys.readouterr()
    assert "INT-4242" in captured.err
    assert "OPS" in captured.err


def test_collect_validation_outcome_matches_cli(monkeypatch, capsys):
    monkeypatch.setattr(check_governance_gate, "collect_recent_category_hints", lambda: ["OPS"])

    body = """Intent: INT-4242
"""

    outcome = check_governance_gate.collect_validation_outcome(body)
    expected_messages = [
        (
            "warning",
            "No intent category pattern (INT-###-CAT-) detected for INT-4242. Consider categories: OPS.",
        ),
        ("error", "PR must reference EVALUATION (acceptance) anchor"),
        (
            "warning",
            "Consider adding 'Priority Score: <number>' based on prioritization.yaml",
        ),
    ]

    assert list(outcome.iter_messages()) == expected_messages
    assert outcome.errors == [expected_messages[1][1]]
    assert outcome.warnings == [expected_messages[0][1], expected_messages[2][1]]
    assert outcome.is_success is False

    captured = capsys.readouterr()
    assert captured.err == ""

    assert check_governance_gate.validate_pr_body(body) is False
    captured = capsys.readouterr()
    assert captured.err.splitlines() == [message for _, message in expected_messages]


def test_collect_validation_outcome_prefers_injected_hints(monkeypatch):
    def _fail():  # pragma: no cover - guard against fallback path
        pytest.fail("collect_recent_category_hints should not be called")

    monkeypatch.setattr(check_governance_gate, "collect_recent_category_hints", _fail)

    body = """
Intent: INT-1234
## EVALUATION
- [Acceptance Criteria](../EVALUATION.md#acceptance-criteria)
Priority Score: 4
"""

    outcome = check_governance_gate.collect_validation_outcome(
        body,
        category_hints=["SEC", "QA"],
    )

    expected_warning = (
        "warning",
        "No intent category pattern (INT-###-CAT-) detected for INT-1234. Consider categories: SEC, QA.",
    )

    assert list(outcome.iter_messages()) == [expected_warning]
    assert outcome.errors == []
    assert outcome.warnings == [expected_warning[1]]
    assert outcome.is_success is True


def test_category_hint_resolver_prefers_explicit_base_ref():
    requested: list[str] = []

    def _fake_changed(refspec: str) -> list[str]:
        requested.append(refspec)
        if refspec == "origin/develop...HEAD":
            return ["ops/runbook.md", "docs/guide.md"]
        return []

    resolver = CategoryHintResolver(
        env_getter=lambda key: {"GITHUB_BASE_REF": "main"}.get(key),
        changed_paths_provider=_fake_changed,
    )

    hints = resolver.resolve(base_ref="develop")

    assert hints == ["OPS", "DOCS"]
    assert requested == ["origin/develop...HEAD"]


def test_category_hint_resolver_uses_fallback_when_git_diff_fails():
    requested: list[str] = []

    def _fake_changed(refspec: str) -> list[str]:
        requested.append(refspec)
        if refspec == "origin/main...HEAD":
            raise subprocess.CalledProcessError(returncode=1, cmd=["git", "diff"])
        return ["security/audit.md"]

    resolver = CategoryHintResolver(
        env_getter=lambda key: {"GITHUB_BASE_REF": "main"}.get(key),
        changed_paths_provider=_fake_changed,
    )

    hints = resolver.resolve()

    assert hints == ["SEC"]
    assert requested == ["origin/main...HEAD", "HEAD^..HEAD"]


def test_category_hint_resolver_returns_empty_on_failures():
    requested: list[str] = []

    def _fake_changed(refspec: str) -> list[str]:
        requested.append(refspec)
        raise subprocess.CalledProcessError(returncode=1, cmd=["git", "diff"])

    resolver = CategoryHintResolver(
        env_getter=lambda key: {"GITHUB_BASE_REF": "main"}.get(key),
        changed_paths_provider=_fake_changed,
    )

    hints = resolver.resolve()

    assert hints == []
    assert requested == ["origin/main...HEAD", "HEAD^..HEAD"]


def test_collect_recent_category_hints_uses_base_ref(monkeypatch):
    paths_by_refspec = {
        "origin/main...HEAD": ["docs/guide.md", "ops/runbook.md"],
        "HEAD^..HEAD": ["ops/runbook.md"],
    }

    def _fake(refspec: str):
        if refspec not in paths_by_refspec:
            pytest.fail(f"Unexpected refspec requested: {refspec}")
        return paths_by_refspec[refspec]

    monkeypatch.setattr(check_governance_gate, "get_changed_paths", _fake)
    monkeypatch.setenv("GITHUB_BASE_REF", "main")

    hints = check_governance_gate.collect_recent_category_hints()

    assert hints == ["DOCS", "OPS"]


def test_pr_template_contains_required_sections():
    template = Path(".github/pull_request_template.md").read_text(encoding="utf-8")

    assert "## Intent Metadata" in template
    assert "| Intent ID | INT-___ |" in template
    assert "| EVALUATION Anchor | [Acceptance Criteria](../EVALUATION.md#acceptance-criteria) |" in template
    assert "| Priority Score |" in template
    assert "## INT Logs" in template


def test_main_accepts_pr_body_env(monkeypatch, capsys):
    monkeypatch.setattr(check_governance_gate, "get_changed_paths", lambda refspec: [])
    monkeypatch.setenv(
        "PR_BODY",
        """Intent: INT-999-OPS-Migrate\n## EVALUATION\n- [Acceptance Criteria](../EVALUATION.md#acceptance-criteria)\nPriority Score: 2\n""",
    )
    monkeypatch.delenv("GITHUB_EVENT_PATH", raising=False)

    exit_code = check_governance_gate.main()

    assert exit_code == 0
    captured = capsys.readouterr()
    assert captured.err == ""


def test_main_accepts_pr_body_path_argument(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(check_governance_gate, "get_changed_paths", lambda refspec: [])
    monkeypatch.delenv("PR_BODY", raising=False)
    monkeypatch.delenv("GITHUB_EVENT_PATH", raising=False)
    body_path = tmp_path / "body.md"
    body_path.write_text(
        """Intent: INT-4242-PLAT-Upgrade\n## EVALUATION\n- [Acceptance Criteria](../EVALUATION.md#acceptance-criteria)\nPriority Score: 2\n""",
        encoding="utf-8",
    )

    exit_code = check_governance_gate.main(("--pr-body-path", str(body_path)))

    assert exit_code == 0
    captured = capsys.readouterr()
    assert captured.err == ""


def test_main_requires_pr_body(monkeypatch, capsys):
    monkeypatch.setattr(check_governance_gate, "get_changed_paths", lambda refspec: [])
    monkeypatch.delenv("PR_BODY", raising=False)
    monkeypatch.delenv("GITHUB_EVENT_PATH", raising=False)

    exit_code = check_governance_gate.main()

    assert exit_code == 1
    captured = capsys.readouterr()
    assert "PR body data is unavailable" in captured.err


def test_pr_body_resolver_prefers_cli(monkeypatch):
    env_data = {
        "PR_BODY": "env body",
        "PR_BODY_PATH": "/tmp/pr_body_env.md",
        "GITHUB_EVENT_PATH": "/tmp/event.json",
    }

    def fake_env_getter(key: str) -> str | None:
        return env_data.get(key)

    recorded_paths: list[Path] = []

    def fake_path_reader(path: Path) -> str | None:
        recorded_paths.append(path)
        return f"read:{path}"

    resolver = PRBodyResolver(
        env_getter=fake_env_getter,
        path_reader=fake_path_reader,
        event_reader=lambda path: "event body",
    )

    result = resolver.resolve(cli_body="cli body", cli_body_path=Path("/tmp/cli.md"))

    assert isinstance(result, ResolutionResult)
    assert result.body == "cli body"
    assert result.errors == []
    assert recorded_paths == []


def test_pr_body_resolver_uses_env_and_path(monkeypatch, tmp_path):
    env_body_path = tmp_path / "body.md"
    env_body_path.write_text("env path body", encoding="utf-8")

    env_data = {
        "PR_BODY": "env body",
        "PR_BODY_PATH": str(env_body_path),
    }

    def fake_env_getter(key: str) -> str | None:
        return env_data.get(key)

    resolver = PRBodyResolver(
        env_getter=fake_env_getter,
        path_reader=lambda path: path.read_text(encoding="utf-8"),
        event_reader=lambda path: "event body",
    )

    result_direct = resolver.resolve()
    assert result_direct.body == "env body"
    assert result_direct.errors == []

    env_data.pop("PR_BODY")
    result_from_path = resolver.resolve()
    assert result_from_path.body == "env path body"
    assert result_from_path.errors == []


def test_pr_body_resolver_reads_event_payload(tmp_path):
    event_path = tmp_path / "event.json"
    event_path.write_text('{"pull_request": {"body": "event body"}}', encoding="utf-8")

    env_data = {"GITHUB_EVENT_PATH": str(event_path)}

    resolver = PRBodyResolver(
        env_getter=env_data.get,
        path_reader=lambda path: None,
        event_reader=lambda path: "event body" if path == event_path else None,
    )

    result = resolver.resolve()

    assert result.body == "event body"
    assert result.errors == []


def test_pr_body_resolver_collects_failure_reasons(tmp_path):
    missing_path = tmp_path / "missing.md"

    env_data: dict[str, str] = {
        "PR_BODY_PATH": str(missing_path),
        "GITHUB_EVENT_PATH": str(tmp_path / "missing-event.json"),
    }

    def fake_env_getter(key: str) -> str | None:
        return env_data.get(key)

    recorded_paths: list[Path] = []

    def fake_path_reader(path: Path) -> str | None:
        recorded_paths.append(path)
        return None

    resolver = PRBodyResolver(
        env_getter=fake_env_getter,
        path_reader=fake_path_reader,
        event_reader=lambda path: None,
    )

    result = resolver.resolve()

    assert result.body is None
    assert result.errors == [
        f"PR body file not found: {missing_path}",
        "PR body data is unavailable. Set PR_BODY or GITHUB_EVENT_PATH.",
    ]
    assert recorded_paths == [missing_path]
    assert (
        result.combined_error_message
        == "\n".join(
            [
                f"PR body file not found: {missing_path}",
                "PR body data is unavailable. Set PR_BODY or GITHUB_EVENT_PATH.",
            ]
        )
    )

    buffer = io.StringIO()
    result.emit_errors(stream=buffer)
    assert buffer.getvalue() == (
        "PR body file not found: {0}\nPR body data is unavailable. Set PR_BODY or GITHUB_EVENT_PATH.\n".format(
            missing_path
        )
    )
