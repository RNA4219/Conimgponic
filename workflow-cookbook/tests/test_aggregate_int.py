from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.ci.aggregate_int import _REPO_ROOT, _read_commits, collect_category_metrics, write_metrics


def test_collects_categories_from_pr_body_and_commits() -> None:
    pr_body = """### 概要\n\n- 種別: feature / docs\n"""
    commits = ["fix: resolve edge case", "chore: tidy deps", "docs(readme): clarify usage"]

    metrics = collect_category_metrics(pr_body, commits)

    assert metrics["sources"]["pr_body"] == {"docs": 1, "feature": 1}
    assert metrics["sources"]["commits"] == {"chore": 1, "docs": 1, "fix": 1}
    assert metrics["combined"] == {"chore": 1, "docs": 2, "feature": 1, "fix": 1}


def test_writes_expected_json_structure(tmp_path: Path) -> None:
    pr_body = "- 種別: fix / docs"
    commits = ["feature: add api", "docs: update readme"]
    metrics = collect_category_metrics(pr_body, commits)
    destination = tmp_path / "int-metrics.json"

    write_metrics(metrics, destination)

    written = json.loads(destination.read_text(encoding="utf-8"))
    assert set(written) == {"combined", "sources"}
    assert set(written["sources"]) == {"commits", "pr_body"}
    assert written == metrics


def test_read_commits_uses_repo_root(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("COMMIT_MESSAGES", raising=False)
    monkeypatch.delenv("COMMIT_MESSAGES_PATH", raising=False)

    captured: dict[str, Path | None] = {"cwd": None}

    def fake_run(*args, **kwargs):  # type: ignore[no-untyped-def]
        captured["cwd"] = kwargs.get("cwd")
        return SimpleNamespace(returncode=0, stdout="feat: awesome change\n")

    monkeypatch.setattr("tools.ci.aggregate_int.subprocess.run", fake_run)

    result = _read_commits(None)

    assert result == ["feat: awesome change"]
    assert captured["cwd"] == _REPO_ROOT
