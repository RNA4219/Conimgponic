# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 RNA4219

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence


@dataclass(frozen=True)
class MetricDefinition:
    key: str
    prometheus_names: tuple[str, ...]
    log_paths: tuple[tuple[str, ...], ...]
    scale: float = 1.0

    def from_prometheus(self, values: Mapping[str, float]) -> float | None:
        for name in self.prometheus_names:
            value = values.get(name)
            if isinstance(value, (int, float)):
                return float(value) * self.scale
        return None

    def from_log_entry(self, entry: Mapping[str, Any]) -> float | None:
        for path in self.log_paths:
            value = _lookup_path(entry, path)
            if isinstance(value, (int, float)):
                return float(value) * self.scale
        return None


METRIC_DEFINITIONS: tuple[MetricDefinition, ...] = (
    MetricDefinition(
        key="compress_ratio",
        prometheus_names=("compress_ratio",),
        log_paths=(("compress_ratio",), ("metrics", "compress_ratio")),
    ),
    MetricDefinition(
        key="semantic_retention",
        prometheus_names=("semantic_retention",),
        log_paths=(("semantic_retention",), ("metrics", "semantic_retention")),
    ),
)

METRIC_KEYS: tuple[str, ...] = tuple(definition.key for definition in METRIC_DEFINITIONS)
PROMETHEUS_NAMES: frozenset[str] = frozenset(
    name for definition in METRIC_DEFINITIONS for name in definition.prometheus_names
)


class MetricsCollectionError(RuntimeError):
    """Raised when metrics could not be collected."""


def _lookup_path(entry: Mapping[str, Any], path: tuple[str, ...]) -> Any:
    current: Any = entry
    for segment in path:
        if not isinstance(current, Mapping):
            return None
        current = current.get(segment)
        if current is None:
            return None
    return current


def _parse_prometheus(text: str) -> dict[str, float]:
    metrics: dict[str, float] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        parts = stripped.split()
        if len(parts) < 2:
            continue
        name, raw_value = parts[0], parts[1]
        if name in PROMETHEUS_NAMES:
            try:
                metrics[name] = float(raw_value)
            except ValueError:
                continue
    return metrics


def _load_prometheus(metrics_url: str) -> Mapping[str, float]:
    try:
        with urllib.request.urlopen(metrics_url) as response:  # type: ignore[arg-type]
            payload = response.read()
    except OSError as exc:  # urllib.request raises URLError, an OSError subclass
        raise MetricsCollectionError(f"Failed to read metrics from {metrics_url}: {exc}") from exc
    return _parse_prometheus(payload.decode("utf-8"))


def _load_chainlit_log(path: Path) -> Sequence[Mapping[str, Any]]:
    if not path.exists():
        raise MetricsCollectionError(f"Chainlit log not found: {path}")
    entries: list[Mapping[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, Mapping):
            entries.append(parsed)
    return entries


def _resolve_metrics(
    prometheus_values: Mapping[str, float], log_entries: Sequence[Mapping[str, Any]]
) -> dict[str, float]:
    resolved: dict[str, float] = {}
    missing: list[str] = []
    for definition in METRIC_DEFINITIONS:
        value = definition.from_prometheus(prometheus_values)
        if value is None:
            for entry in log_entries:
                value = definition.from_log_entry(entry)
                if value is not None:
                    break
        if value is None:
            missing.append(definition.key)
        else:
            resolved[definition.key] = value
    if missing:
        raise MetricsCollectionError("Missing metrics: " + ", ".join(missing))
    return {key: resolved[key] for key in METRIC_KEYS}


def collect_metrics(metrics_url: str | None, log_path: Path | None) -> dict[str, float]:
    prometheus_values: Mapping[str, float] = {}
    log_entries: Sequence[Mapping[str, Any]] = ()
    if metrics_url:
        prometheus_values = _load_prometheus(metrics_url)
    if log_path:
        log_entries = _load_chainlit_log(log_path)
    if not metrics_url and log_path is None:
        raise MetricsCollectionError("At least one of --metrics-url or --log-path is required")
    return _resolve_metrics(prometheus_values, log_entries)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Collect performance metrics for post-processing")
    parser.add_argument("--metrics-url", help="Prometheus metrics endpoint URL")
    parser.add_argument("--log-path", type=Path, help="Path to Chainlit log file")
    args = parser.parse_args(argv)

    if not args.metrics_url and args.log_path is None:
        parser.error("At least one of --metrics-url or --log-path must be provided")

    try:
        metrics = collect_metrics(args.metrics_url, args.log_path)
    except MetricsCollectionError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    sys.stdout.write(json.dumps(metrics, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
