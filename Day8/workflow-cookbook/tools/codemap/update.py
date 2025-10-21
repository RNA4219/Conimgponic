# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 RNA4219

"""Birdseye再生成ツール。"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence


@dataclass(frozen=True)
class UpdateOptions:
    targets: tuple[Path, ...]
    emit: str
    dry_run: bool = False


@dataclass(frozen=True)
class UpdateReport:
    generated_at: str
    planned_writes: tuple[Path, ...]
    performed_writes: tuple[Path, ...]


def _derive_targets_from_since(reference: str) -> tuple[Path, ...]:
    result = subprocess.run(
        ["git", "diff", "--name-only", f"{reference}...HEAD"],
        capture_output=True,
        text=True,
        check=True,
    )
    targets: list[Path] = []
    for line in result.stdout.splitlines():
        candidate = line.strip()
        if not candidate:
            continue
        path = Path(candidate)
        if path.parts[:2] != ("docs", "birdseye"):
            continue
        targets.append(path)
    return tuple(dict.fromkeys(targets))


def parse_args(argv: Iterable[str] | None = None) -> UpdateOptions:
    parser = argparse.ArgumentParser(
        description="Regenerate Birdseye index and capsules.",
    )
    parser.add_argument(
        "--targets",
        type=str,
        help="Comma-separated list of Birdseye resources to analyse.",
    )
    parser.add_argument(
        "--since",
        type=str,
        nargs="?",
        const="main",
        help="Derive targets from git diff since the given reference (default: main).",
    )
    parser.add_argument(
        "--emit",
        type=str,
        choices=("index", "caps", "index+caps"),
        default="index+caps",
        help="Select which artefacts to write.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute updates without writing to disk.",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)
    target_paths: list[Path] = []
    if args.targets:
        target_paths.extend(
            Path(value.strip()) for value in args.targets.split(",") if value.strip()
        )
    if args.since:
        try:
            derived = _derive_targets_from_since(args.since)
        except subprocess.CalledProcessError as exc:
            parser.error(f"Failed to resolve git diff for --since: {exc}")
        target_paths.extend(derived)
    unique_targets = tuple(dict.fromkeys(target_paths))
    if not unique_targets:
        parser.error("Specify --targets, --since, or both")
    return UpdateOptions(targets=unique_targets, emit=args.emit, dry_run=args.dry_run)


def ensure_python_version() -> None:
    if sys.version_info < (3, 11):
        print("[ERROR] Python 3.11 or newer is required.")
        raise SystemExit(1)


_SERIAL_WIDTH = 5


def _parse_serial_token(value: object) -> int:
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return 0


def _format_serial_token(counter: int) -> str:
    return f"{counter:0{_SERIAL_WIDTH}d}"


def _resolve_root(target: Path) -> Path:
    if target.is_dir():
        if target.name == "caps":
            return target.parent
        return target
    if target.parent.name == "caps":
        return target.parent.parent
    return target.parent


def _load_json(path: Path) -> tuple[Any, str]:
    raw = path.read_text(encoding="utf-8")
    return json.loads(raw), raw


def _dump_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def _sorted_unique(items: Sequence[str]) -> list[str]:
    return sorted(dict.fromkeys(items))


def _maybe_write(
    path: Path,
    data: Any,
    original: str,
    *,
    planned: set[Path],
    performed: set[Path],
    dry_run: bool,
) -> None:
    serialized = _dump_json(data)
    if serialized == original:
        return
    planned.add(path)
    if dry_run:
        return
    path.write_text(serialized, encoding="utf-8")
    performed.add(path)


def _finalise(paths: set[Path]) -> tuple[Path, ...]:
    return tuple(sorted(paths, key=lambda candidate: candidate.as_posix()))


def run_update(options: UpdateOptions) -> UpdateReport:
    emit_index = options.emit in {"index", "index+caps"}
    emit_caps = options.emit in {"caps", "index+caps"}
    planned: set[Path] = set()
    performed: set[Path] = set()
    grouped: dict[Path, list[Path]] = {}
    for target in options.targets:
        root = _resolve_root(target)
        grouped.setdefault(root, []).append(target)

    serial_token = _format_serial_token(0)
    for root, root_targets in grouped.items():
        index_path = root / "index.json"
        caps_dir = root / "caps"
        hot_path = root / "hot.json"

        if not index_path.is_file():
            raise FileNotFoundError(index_path)
        if emit_caps and not caps_dir.is_dir():
            raise FileNotFoundError(caps_dir)

        index_data, index_original = _load_json(index_path)
        raw_nodes = index_data.get("nodes", {})
        if not isinstance(raw_nodes, dict):
            raw_nodes = {}
        graph_out: dict[str, list[str]] = {node: [] for node in raw_nodes}
        graph_in: dict[str, list[str]] = {node: [] for node in raw_nodes}
        for raw_edge in index_data.get("edges", []):
            if not isinstance(raw_edge, Sequence) or len(raw_edge) != 2:
                continue
            source, destination = raw_edge
            if not isinstance(source, str) or not isinstance(destination, str):
                continue
            graph_out.setdefault(source, []).append(destination)
            graph_in.setdefault(destination, []).append(source)
            graph_out.setdefault(destination, graph_out.get(destination, []))
            graph_in.setdefault(source, graph_in.get(source, []))

        for values in graph_out.values():
            values.sort()
        for values in graph_in.values():
            values.sort()

        caps_state: dict[str, tuple[Path, dict[str, Any], str]] = {}
        cap_path_lookup: dict[Path, str] = {}
        if emit_caps:
            for cap_path in sorted(caps_dir.glob("*.json")):
                if not cap_path.is_file():
                    continue
                cap_data, cap_original = _load_json(cap_path)
                if not isinstance(cap_data, dict):
                    continue
                cap_id = cap_data.get("id")
                if not isinstance(cap_id, str):
                    continue
                caps_state[cap_id] = (cap_path, cap_data, cap_original)
                cap_path_lookup[cap_path.resolve()] = cap_id

        serial_base = _parse_serial_token(index_data.get("generated_at"))

        hot_payload: tuple[dict[str, Any], str] | None = None
        if emit_index and hot_path.exists():
            hot_data, hot_original = _load_json(hot_path)
            if isinstance(hot_data, dict):
                serial_base = max(serial_base, _parse_serial_token(hot_data.get("generated_at")))
                hot_payload = (hot_data, hot_original)

        nodes_to_refresh: list[str] = []
        if emit_caps and caps_state:
            focus_nodes: set[str] = set()
            root_resolved = root.resolve()
            index_resolved = (root / "index.json").resolve()
            caps_dir_resolved = caps_dir.resolve()
            hot_resolved = (root / "hot.json").resolve()
            for candidate in root_targets:
                resolved = candidate.resolve()
                if resolved in {
                    root_resolved,
                    index_resolved,
                    caps_dir_resolved,
                    hot_resolved,
                }:
                    focus_nodes = set(caps_state)
                    break
                cap_id = cap_path_lookup.get(resolved)
                if cap_id:
                    focus_nodes.add(cap_id)
            if not focus_nodes:
                focus_nodes = set(caps_state)
            seen: set[str] = set()
            queue: deque[tuple[str, int]] = deque((node, 0) for node in focus_nodes)
            while queue:
                node, distance = queue.popleft()
                if node in seen or distance > 2:
                    continue
                seen.add(node)
                if distance == 2:
                    continue
                for neighbour in graph_out.get(node, []):
                    if neighbour not in seen:
                        queue.append((neighbour, distance + 1))
                for neighbour in graph_in.get(node, []):
                    if neighbour not in seen:
                        queue.append((neighbour, distance + 1))
            nodes_to_refresh = sorted(node for node in seen if node in caps_state)
            for cap_id in nodes_to_refresh:
                cap_data = caps_state[cap_id][1]
                serial_base = max(serial_base, _parse_serial_token(cap_data.get("generated_at")))

        index_nodes_to_update: list[tuple[str, dict[str, Any]]] = []
        if emit_index:
            node_ids: Iterable[str]
            if nodes_to_refresh:
                node_ids = nodes_to_refresh
            else:
                node_ids = tuple(
                    node_id
                    for node_id, payload in raw_nodes.items()
                    if isinstance(payload, dict)
                )
            for node_id in node_ids:
                node_payload = raw_nodes.get(node_id)
                if not isinstance(node_payload, dict):
                    continue
                serial_base = max(serial_base, _parse_serial_token(node_payload.get("mtime")))
                index_nodes_to_update.append((node_id, node_payload))

        serial_token = _format_serial_token(serial_base + 1)

        if emit_index:
            if index_data.get("generated_at") != serial_token:
                index_data["generated_at"] = serial_token
            for _, node_payload in index_nodes_to_update:
                if node_payload.get("mtime") != serial_token:
                    node_payload["mtime"] = serial_token
            _maybe_write(
                index_path,
                index_data,
                index_original,
                planned=planned,
                performed=performed,
                dry_run=options.dry_run,
            )

            if hot_payload is not None:
                hot_data, hot_original = hot_payload
                if hot_data.get("generated_at") != serial_token:
                    hot_data["generated_at"] = serial_token
                _maybe_write(
                    hot_path,
                    hot_data,
                    hot_original,
                    planned=planned,
                    performed=performed,
                    dry_run=options.dry_run,
                )

        if emit_caps and nodes_to_refresh:
            for cap_id in nodes_to_refresh:
                cap_path, cap_data, cap_original = caps_state[cap_id]
                expected_out = _sorted_unique(graph_out.get(cap_id, []))
                expected_in = _sorted_unique(graph_in.get(cap_id, []))
                updated = False
                if cap_data.get("deps_out") != expected_out:
                    cap_data["deps_out"] = expected_out
                    updated = True
                if cap_data.get("deps_in") != expected_in:
                    cap_data["deps_in"] = expected_in
                    updated = True
                if cap_data.get("generated_at") != serial_token:
                    cap_data["generated_at"] = serial_token
                    updated = True
                if updated:
                    _maybe_write(
                        cap_path,
                        cap_data,
                        cap_original,
                        planned=planned,
                        performed=performed,
                        dry_run=options.dry_run,
                    )

    return UpdateReport(
        generated_at=serial_token,
        planned_writes=_finalise(planned),
        performed_writes=_finalise(performed),
    )


def main(argv: Iterable[str] | None = None) -> int:
    ensure_python_version()
    options = parse_args(argv)
    run_update(options)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
