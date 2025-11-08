# SPDX-License-Identifier: Apache-2.0
"""Verify audit log chains generated with HMAC signatures."""

from __future__ import annotations

import argparse
import hmac
import json
import sys
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Iterable, Mapping, Sequence


class VerificationFailure(RuntimeError):
    """Raised when audit log chain verification fails."""


@dataclass(frozen=True)
class LogEntry:
    payload: str
    previous_signature: str
    signature: str


def parse_log_entries(log_file: Path) -> Iterable[LogEntry]:
    with log_file.open("r", encoding="utf-8") as handle:
        for index, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError as exc:  # pragma: no cover - validated in tests via failure path
                raise VerificationFailure(f"Line {index}: invalid JSON: {exc}") from exc
            if not isinstance(payload, Mapping):
                raise VerificationFailure(f"Line {index}: expected object, received {type(payload).__name__}")
            try:
                yield LogEntry(
                    payload=str(payload["payload"]),
                    previous_signature=str(payload["previous_signature"]),
                    signature=str(payload["signature"]),
                )
            except KeyError as exc:
                raise VerificationFailure(f"Line {index}: missing field {exc.args[0]}") from exc


def compute_expected_signature(secret: bytes, previous_signature: str, payload: str) -> str:
    return hmac.new(secret, f"{previous_signature}:{payload}".encode("utf-8"), sha256).hexdigest()


def verify_log_entries(log_file: Path, secret: str, initial_signature: str = "") -> None:
    secret_bytes = secret.encode("utf-8")
    expected_previous = initial_signature
    for entry in parse_log_entries(log_file):
        if entry.previous_signature != expected_previous:
            raise VerificationFailure(
                "previous signature mismatch: expected "
                f"{expected_previous or '<initial>'}, received {entry.previous_signature}"
            )
        expected_signature = compute_expected_signature(secret_bytes, entry.previous_signature, entry.payload)
        if entry.signature != expected_signature:
            raise VerificationFailure(
                "signature mismatch: expected "
                f"{expected_signature}, received {entry.signature}"
            )
        expected_previous = entry.signature


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Verify JSONL audit log chains with HMAC signatures.")
    parser.add_argument("log_file", type=Path, help="Path to the JSONL audit log.")
    parser.add_argument("--secret", required=True, help="Shared secret used for HMAC verification.")
    parser.add_argument("--initial-signature", default="", help="Initial signature seed for the first entry.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        verify_log_entries(args.log_file, args.secret, args.initial_signature)
    except VerificationFailure as exc:
        print(f"Verification failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    raise SystemExit(main())
