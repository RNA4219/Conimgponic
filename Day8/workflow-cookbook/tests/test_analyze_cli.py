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


def test_cli_emits_reports_json_and_birdseye(tmp_path: Path) -> None:
    _write_log(
        tmp_path,
        "\n".join(
            [
                '{"flow":"build","status":"passed","message":"ok"}',
                '{"flow":"audit","status":"warning","message":"moderate"}',
                '{"flow":"sbom","status":"passed","message":"syft"}',
                '{"flow":"license","status":"passed","message":"allowlist"}',
                '{"flow":"golden","status":"passed","message":"fixtures"}',
            ]
        ),
    )

    result = _run(tmp_path, "--emit", "report", "json", "birdseye", "--focus", "docs")

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert sorted(payload["flows"]) == ["audit", "build", "golden", "license", "sbom"]
    report_dir = tmp_path / "reports" / "day8" / "ci"
    summary = (report_dir / "summary.md").read_text(encoding="utf-8")
    assert summary.startswith("# Day8 CI reflection")
    assert "| build | passed |" in summary
    assert "| license | passed | allowlist |" in summary
    issues = (report_dir / "issues.md").read_text(encoding="utf-8")
    assert "audit" in issues
    capsule = json.loads((report_dir / "birdseye.json").read_text(encoding="utf-8"))
    assert capsule["capsule"] == "day8-ci"
    assert capsule["flows"]["audit"]["outcome"] == "warning"


def test_fail_on_warnings_exits_non_zero(tmp_path: Path) -> None:
    _write_log(
        tmp_path,
        "\n".join(
            [
                '{"flow":"build","status":"passed","message":"vite"}',
                '{"flow":"audit","status":"passed","message":"allowlist"}',
                '{"flow":"sbom","status":"passed","message":"syft"}',
                '{"flow":"license","status":"warning","message":"review"}',
                '{"flow":"golden","status":"passed","message":"fixtures"}',
            ]
        ),
    )
    result = _run(tmp_path, "--emit", "report", "--fail-on", "warnings")
    assert result.returncode == 1


def test_focus_license_filters_report(tmp_path: Path) -> None:
    _write_log(
        tmp_path,
        "\n".join(
            [
                '{"flow":"build","status":"passed","message":"ok"}',
                '{"flow":"license","status":"passed","message":"allowlist"}',
                '{"flow":"golden","status":"passed","message":"fixtures"}',
            ]
        ),
    )

    result = _run(tmp_path, "--emit", "report", "--focus", "license")

    assert result.returncode == 0, result.stderr
    summary = (tmp_path / "reports" / "day8" / "ci" / "summary.md").read_text(encoding="utf-8")
    assert "| Flow |" in summary
    assert summary.count("| license | passed | allowlist |") == 1
    assert "| build |" not in summary


def test_fail_on_errors_requires_errors(tmp_path: Path) -> None:
    _write_log(
        tmp_path,
        "\n".join(
            [
                '{"flow":"build","status":"passed","message":"vite"}',
                '{"flow":"audit","status":"passed","message":"allowlist"}',
                '{"flow":"sbom","status":"passed","message":"syft"}',
                '{"flow":"license","status":"warning","message":"review"}',
                '{"flow":"golden","status":"passed","message":"fixtures"}',
            ]
        ),
    )
    ok_result = _run(tmp_path, "--emit", "report", "--fail-on", "errors")
    assert ok_result.returncode == 0

    _write_log(
        tmp_path,
        "\n".join(
            [
                '{"flow":"build","status":"passed","message":"vite"}',
                '{"flow":"audit","status":"passed","message":"allowlist"}',
                '{"flow":"sbom","status":"passed","message":"syft"}',
                '{"flow":"license","status":"error","message":"deny"}',
                '{"flow":"golden","status":"passed","message":"fixtures"}',
            ]
        ),
    )
    fail_result = _run(tmp_path, "--emit", "report", "--fail-on", "errors")
    assert fail_result.returncode == 1
