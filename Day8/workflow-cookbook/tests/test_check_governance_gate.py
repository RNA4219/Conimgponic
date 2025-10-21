import sys
from pathlib import Path

import pytest

sys.path.append(str(Path(__file__).resolve().parents[1]))

from tools.ci import check_governance_gate
from tools.ci.check_governance_gate import validate_pr_body


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
