from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.audit.verify_log_chain import (
    VerificationFailure,
    compute_expected_signature,
    verify_log_entries,
)
from tools.audit.purge_logs import purge_expired_logs


def _write_jsonl(path: Path, entries: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for entry in entries:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _build_entry(secret: str, payload: str, prev_signature: str) -> dict[str, str]:
    signature = compute_expected_signature(secret.encode("utf-8"), prev_signature, payload)
    return {
        "payload": payload,
        "previous_signature": prev_signature,
        "signature": signature,
    }


def test_verify_log_entries_success(tmp_path: Path) -> None:
    secret = "shared-secret"
    initial_signature = "initial"
    payloads = ["first", "second", "final"]

    entries: list[dict[str, str]] = []
    prev = initial_signature
    for payload in payloads:
        entry = _build_entry(secret, payload, prev)
        entries.append(entry)
        prev = entry["signature"]

    log_path = tmp_path / "chain.jsonl"
    _write_jsonl(log_path, entries)

    verify_log_entries(log_path, secret, initial_signature)


def test_verify_log_entries_detects_invalid_signature(tmp_path: Path) -> None:
    secret = "shared-secret"
    initial_signature = "seed"

    valid_entry = _build_entry(secret, "legit", initial_signature)
    invalid_entry = {
        **_build_entry(secret, "tampered", valid_entry["signature"]),
        "signature": "deadbeef",
    }

    log_path = tmp_path / "broken.jsonl"
    _write_jsonl(log_path, [valid_entry, invalid_entry])

    with pytest.raises(VerificationFailure):
        verify_log_entries(log_path, secret, initial_signature)


def test_purge_expired_logs_respects_boundary(tmp_path: Path) -> None:
    now = datetime(2024, 1, 31, 12, 0, 0)
    older_than_days = 7

    stale_file = tmp_path / "stale.log"
    fresh_file = tmp_path / "fresh.log"
    boundary_file = tmp_path / "boundary.log"

    for file_path in (stale_file, fresh_file, boundary_file):
        file_path.write_text("log", encoding="utf-8")

    seconds_in_day = 24 * 60 * 60
    os.utime(stale_file, (now.timestamp() - seconds_in_day * 8, now.timestamp() - seconds_in_day * 8))
    os.utime(fresh_file, (now.timestamp() - seconds_in_day * 1, now.timestamp() - seconds_in_day * 1))
    os.utime(boundary_file, (now.timestamp() - seconds_in_day * older_than_days, now.timestamp() - seconds_in_day * older_than_days))

    removed = purge_expired_logs(tmp_path, older_than_days, now=now)

    remaining = set(tmp_path.iterdir())

    assert stale_file not in remaining
    assert fresh_file in remaining
    assert boundary_file in remaining
    assert removed == [stale_file]
