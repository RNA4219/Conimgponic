from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[3]
REQUIREMENTS = REPO_ROOT / "workflow-cookbook" / "requirements.txt"
EXPECTED_PACKAGES = {
    "mypy",
    "ruff",
    "pytest",
    "pip-audit",
    "PyYAML",
    "types-PyYAML",
}


def test_requirements_file_contains_ci_tools() -> None:
    assert REQUIREMENTS.exists(), "workflow-cookbook/requirements.txt is missing"
    lines = [line.strip() for line in REQUIREMENTS.read_text(encoding="utf-8").splitlines()]
    packages = {line.split("==", 1)[0] for line in lines if line and not line.startswith("#")}
    assert EXPECTED_PACKAGES.issubset(packages)


def test_pip_install_requirements(tmp_path: Path) -> None:
    cache_dir = tmp_path / "pip-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        "--dry-run",
        "-r",
        str(REQUIREMENTS),
    ]
    env = os.environ.copy()
    env.update({"PIP_CACHE_DIR": str(cache_dir)})
    result = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if result.returncode != 0 and "proxy" in result.stderr.lower():
        pytest.skip(f"pip install skipped due to network restrictions: {result.stderr}")
    assert result.returncode == 0, result.stderr
