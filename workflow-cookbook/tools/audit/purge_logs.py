# SPDX-License-Identifier: Apache-2.0
"""Purge audit logs that exceeded the configured retention period."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Sequence


def _resolve_targets(target: Path) -> Iterable[Path]:
    if target.is_file():
        yield target
        return
    if not target.exists():
        return
    for child in target.iterdir():
        if child.is_file():
            yield child


def purge_expired_logs(directory: Path, older_than_days: int, now: datetime | None = None) -> list[Path]:
    if older_than_days <= 0:
        raise ValueError("older_than_days must be a positive integer")
    reference = now or datetime.now(timezone.utc)
    cutoff_timestamp = reference.timestamp() - older_than_days * 24 * 60 * 60
    removed: list[Path] = []
    for candidate in _resolve_targets(directory):
        if candidate.stat().st_mtime < cutoff_timestamp:
            candidate.unlink()
            removed.append(candidate)
    removed.sort()
    return removed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Purge audit log files older than the retention window.")
    parser.add_argument("path", type=Path, help="Directory (or single file) containing audit logs.")
    parser.add_argument("--older-than", type=int, required=True, help="Delete files strictly older than this many days.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    removed: list[Path] = []
    try:
        removed = purge_expired_logs(args.path, args.older_than)
    except ValueError as exc:
        parser.error(str(exc))
    if not removed:
        return 0
    for path in removed:
        print(path)
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    raise SystemExit(main())
