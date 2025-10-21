# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 RNA4219

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path
from typing import Iterable, Mapping, MutableMapping, Sequence

METRIC_KEYS: tuple[str, ...] = ("compress_ratio", "semantic_retention")


class MetricsCollectionError(RuntimeError):
    """Raised when metrics could not be collected."""


def _capture(source: Mapping[str, object], target: MutableMapping[str, float]) -> None:
    for key in METRIC_KEYS:
        if key in target:
            continue
        value = source.get(key)
        if isinstance(value, (int, float)):
            target[key] = float(value)


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
        if name in METRIC_KEYS:
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


def _load_chainlit_log(path: Path) -> Mapping[str, float]:
    if not path.exists():
        raise MetricsCollectionError(f"Chainlit log not found: {path}")
    metrics: dict[str, float] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, Mapping):
            _capture(parsed, metrics)
            nested = parsed.get("metrics")
            if isinstance(nested, Mapping):
                _capture(nested, metrics)
    return metrics


def _merge(sources: Iterable[Mapping[str, float]]) -> dict[str, float]:
    combined: dict[str, float] = {}
    for mapping in sources:
        _capture(mapping, combined)
    missing = [key for key in METRIC_KEYS if key not in combined]
    if missing:
        raise MetricsCollectionError("Missing metrics: " + ", ".join(missing))
    return {key: combined[key] for key in METRIC_KEYS}


def collect_metrics(metrics_url: str | None, log_path: Path | None) -> dict[str, float]:
    sources: list[Mapping[str, float]] = []
    if metrics_url:
        sources.append(_load_prometheus(metrics_url))
    if log_path:
        sources.append(_load_chainlit_log(log_path))
    if not sources:
        raise MetricsCollectionError("At least one of --metrics-url or --log-path is required")
    return _merge(sources)


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
