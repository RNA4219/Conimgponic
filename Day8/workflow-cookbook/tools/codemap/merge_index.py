from __future__ import annotations
import argparse
import json
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

def _load_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Expected object payload at {path}")
    return data

def _collect_shards(index_path: Path) -> list[Path]:
    shards = [candidate for candidate in index_path.parent.glob("index.*.json") if candidate.name != index_path.name]
    shards.sort(key=lambda item: item.name)
    return shards

def merge(index_path: Path, shard_paths: Sequence[Path] | None = None) -> dict[str, Any]:
    shards = list(shard_paths) if shard_paths is not None else _collect_shards(index_path)
    if not shards:
        raise FileNotFoundError(f"No shard files found for {index_path}")
    base = _load_json(index_path)
    base_nodes = base.get("nodes")
    nodes: dict[str, Any] = {node_id: node_payload for node_id, node_payload in base_nodes.items() if isinstance(node_id, str)} if isinstance(base_nodes, dict) else {}
    base_edges = base.get("edges")
    edges: set[tuple[str, str]] = {(
        raw_edge[0], raw_edge[1]
    ) for raw_edge in base_edges if isinstance(raw_edge, Sequence) and len(raw_edge) == 2 and all(isinstance(item, str) for item in raw_edge)} if isinstance(base_edges, Iterable) else set()
    base_generated = base.get("generated_at")
    generated_tokens: list[str] = [base_generated] if isinstance(base_generated, str) else []
    for shard_path in shards:
        payload = _load_json(shard_path)
        shard_nodes = payload.get("nodes")
        if isinstance(shard_nodes, dict):
            for node_id, node_payload in shard_nodes.items():
                if not isinstance(node_id, str):
                    continue
                if node_id in nodes:
                    if nodes[node_id] != node_payload:
                        raise ValueError(f"Conflicting node '{node_id}' encountered in {shard_path}")
                else:
                    nodes[node_id] = node_payload
        shard_edges = payload.get("edges")
        if isinstance(shard_edges, Iterable):
            for raw_edge in shard_edges:
                if isinstance(raw_edge, Sequence) and len(raw_edge) == 2 and all(isinstance(item, str) for item in raw_edge):
                    edges.add((raw_edge[0], raw_edge[1]))
        generated_at = payload.get("generated_at")
        if isinstance(generated_at, str):
            generated_tokens.append(generated_at)
    generated_at = max(generated_tokens) if generated_tokens else "00000"
    return {"edges": [list(edge) for edge in sorted(edges)], "nodes": nodes, "generated_at": generated_at}

def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Merge Birdseye shard files into index.json.")
    parser.add_argument("--index", type=Path, required=True, help="Path to the aggregate index.json file.")
    parser.add_argument("--write", action="store_true", help="Write merged data back to the index file.")
    args = parser.parse_args(list(argv) if argv is not None else None)
    payload = json.dumps(merge(args.index), ensure_ascii=False, indent=2) + "\n"
    if args.write:
        args.index.write_text(payload, encoding="utf-8")
    else:
        print(payload, end="")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
