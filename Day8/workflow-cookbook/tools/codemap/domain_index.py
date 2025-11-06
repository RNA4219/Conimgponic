# SPDX-License-Identifier: Apache-2.0

"""Birdseye インデックスのドメイン分割ユーティリティ。"""

from __future__ import annotations

import argparse
import json
from json import JSONDecodeError
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Sequence


def _dump_json(payload: Mapping[str, object]) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def _load_json(path: Path) -> tuple[dict[str, object], str]:
    raw = path.read_text(encoding="utf-8")
    try:
        data = json.loads(raw)
    except JSONDecodeError as exc:
        trimmed = raw.rstrip()
        if trimmed.endswith("]\n}"):
            fixed = trimmed[:-3] + "}\n}"
            data = json.loads(fixed)
        else:
            raise ValueError(f"Failed to parse JSON at {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"Expected dictionary at {path}")
    return data, raw


def _maybe_write(path: Path, payload: Mapping[str, object], original: str) -> bool:
    serialized = _dump_json(payload)
    if serialized == original:
        return False
    path.write_text(serialized, encoding="utf-8")
    return True


@dataclass(frozen=True)
class DomainSpec:
    name: str
    prefixes: tuple[str, ...]
    fallback: bool = False

    def matches(self, node_id: str) -> bool:
        if self.fallback:
            return True
        return any(node_id.startswith(prefix) for prefix in self.prefixes)


DEFAULT_DOMAIN_SPECS: tuple[DomainSpec, ...] = (
    DomainSpec(name="docs", prefixes=("docs/",)),
    DomainSpec(name="src", prefixes=("src/",)),
    DomainSpec(name="workflow-cookbook", prefixes=("workflow-cookbook/",)),
    DomainSpec(name="scripts", prefixes=("scripts/",)),
    DomainSpec(name="tools", prefixes=("tools/",)),
    DomainSpec(name="root", prefixes=(), fallback=True),
)


@dataclass(frozen=True)
class GenerationOptions:
    index_path: Path
    output_dir: Path | None = None
    domain_specs: Sequence[DomainSpec] = DEFAULT_DOMAIN_SPECS
    include: Sequence[str] | None = None


@dataclass(frozen=True)
class GenerationReport:
    generated_at: str
    domain_ids: tuple[str, ...]
    written_paths: tuple[Path, ...]


def _classify(node_id: str, specs: Sequence[DomainSpec]) -> DomainSpec:
    for spec in specs:
        if spec.matches(node_id):
            return spec
    raise RuntimeError("No fallback domain spec configured")


def _sorted_edges(edges: Iterable[Sequence[str]]) -> list[list[str]]:
    normalized: set[tuple[str, str]] = set()
    for raw_edge in edges:
        if len(raw_edge) != 2:
            continue
        source, destination = raw_edge
        if not isinstance(source, str) or not isinstance(destination, str):
            continue
        normalized.add((source, destination))
    return [list(edge) for edge in sorted(normalized)]


def generate(options: GenerationOptions) -> GenerationReport:
    index_path = options.index_path
    output_dir = options.output_dir or index_path.parent
    output_dir.mkdir(parents=True, exist_ok=True)

    index_data, index_original = _load_json(index_path)
    nodes = index_data.get("nodes")
    edges = index_data.get("edges")
    if not isinstance(nodes, dict) or not isinstance(edges, Sequence):
        raise ValueError("index.json must contain nodes and edges")

    generated_at = index_data.get("generated_at")
    if not isinstance(generated_at, str):
        generated_at = "00000"

    specs = tuple(options.domain_specs)
    include_names = (
        {name.strip() for name in options.include if name.strip()}
        if options.include is not None
        else {spec.name for spec in specs}
    )
    domain_nodes: dict[str, dict[str, object]] = {spec.name: {} for spec in specs}
    domain_edges: dict[str, set[tuple[str, str]]] = {spec.name: set() for spec in specs}
    node_membership: dict[str, str] = {}

    for node_id, payload in nodes.items():
        if not isinstance(node_id, str) or not isinstance(payload, dict):
            continue
        spec = _classify(node_id, specs)
        domain_nodes[spec.name][node_id] = payload
        node_membership[node_id] = spec.name

    for raw_edge in edges:
        if not isinstance(raw_edge, Sequence) or len(raw_edge) != 2:
            continue
        source, destination = raw_edge
        if not isinstance(source, str) or not isinstance(destination, str):
            continue
        domain_id = node_membership.get(source)
        if domain_id and node_membership.get(destination) == domain_id:
            domain_edges[domain_id].add((source, destination))

    written: list[Path] = []
    shards: list[dict[str, object]] = []
    summary_domains: dict[str, dict[str, int]] = {}

    for spec in specs:
        if spec.name not in include_names:
            continue
        nodes_payload = domain_nodes.get(spec.name, {})
        edges_payload = _sorted_edges(domain_edges.get(spec.name, ()))
        if not nodes_payload and not spec.fallback:
            continue
        shard_path = output_dir / f"index.{spec.name}.json"
        shard_data = {
            "kind": spec.name,
            "generated_at": generated_at,
            "nodes": nodes_payload,
            "edges": edges_payload,
        }
        original = shard_path.read_text(encoding="utf-8") if shard_path.exists() else ""
        if _maybe_write(shard_path, shard_data, original):
            written.append(shard_path)
        shards.append(
            {
                "id": spec.name,
                "path": shard_path.name,
                "generated_at": generated_at,
                "nodes": len(nodes_payload),
                "edges": len(edges_payload),
            }
        )
        summary_domains[spec.name] = {"nodes": len(nodes_payload), "edges": len(edges_payload)}

    summary = index_data.get("summary")
    if not isinstance(summary, dict):
        summary = {}
        index_data["summary"] = summary
    summary["generated_at"] = generated_at
    summary["domains"] = summary_domains
    index_data["shards"] = shards

    if _maybe_write(index_path, index_data, index_original):
        written.append(index_path)

    return GenerationReport(
        generated_at=generated_at,
        domain_ids=tuple(summary_domains),
        written_paths=tuple(written),
    )


def _parse_args(argv: Iterable[str] | None = None) -> GenerationOptions:
    parser = argparse.ArgumentParser(description="Shard Birdseye index into domain-specific files.")
    parser.add_argument("--index", type=Path, required=True, help="Path to the aggregate Birdseye index.json")
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Directory to store shard files (defaults to the index directory).",
    )
    parser.add_argument(
        "--include",
        type=str,
        help="Comma separated domain names to emit (defaults to all known domains).",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)
    include: Sequence[str] | None = None
    if args.include:
        include = [value.strip() for value in args.include.split(",") if value.strip()]
    return GenerationOptions(index_path=args.index, output_dir=args.output_dir, include=include)


def main(argv: Iterable[str] | None = None) -> int:
    options = _parse_args(argv)
    generate(options)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

