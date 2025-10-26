from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "workflow-cookbook" / "scripts" / "analyze.py"


def _write_log(root: Path, content: str) -> None:
    path = root / "workflow-cookbook" / "logs" / "test.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _run(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    cmd = [sys.executable, str(SCRIPT), "--root", str(root), *args]
    return subprocess.run(cmd, cwd=str(REPO_ROOT), capture_output=True, text=True)


def test_cli_emits_reports_and_json(tmp_path: Path) -> None:
    _write_log(
        tmp_path,
        "\n".join(
            [
                '{"flow":"build","status":"passed","message":"ok"}',
                '{"flow":"audit","status":"warning","message":"moderate"}',
                '{"flow":"sbom","status":"passed","message":"syft"}',
                '{"flow":"golden","status":"passed","message":"fixtures"}',
            ]
        ),
    )

    result = _run(tmp_path, "--emit", "report", "json", "--focus", "docs")

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert sorted(payload["flows"]) == ["audit", "build", "golden", "sbom"]
    assert "| build | passed" in (tmp_path / "reports" / "today.md").read_text(encoding="utf-8")
    assert "audit" in (tmp_path / "reports" / "issue_suggestions.md").read_text(encoding="utf-8")


def test_fail_on_warnings_exits_non_zero(tmp_path: Path) -> None:
    _write_log(tmp_path, '{"flow":"build","status":"warning","message":"lint"}')
    result = _run(tmp_path, "--emit", "report", "--fail-on", "warnings")
    assert result.returncode == 1
