from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Literal, Sequence, TypedDict


FLOWS: tuple[str, ...] = ("build", "audit", "sbom", "license", "golden")
DEFAULT_LOG = Path("workflow-cookbook/logs/test.jsonl")
REPORT_PATH = Path("reports/day8/ci/summary.md")
ISSUE_PATH = Path("reports/day8/ci/issues.md")
BIRDSEYE_PATH = Path("reports/day8/ci/birdseye.json")
FlowEntry = TypedDict(
    "FlowEntry", {"outcome": Literal["ok", "warning", "error"], "status": str, "message": str}
)


def _load(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    entries: list[dict[str, str]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        data = json.loads(raw)
        if isinstance(data, dict):
            entries.append({str(k): str(v) for k, v in data.items()})
    return entries


def _summarize(entries: Sequence[dict[str, str]]) -> dict[str, FlowEntry]:
    summary: dict[str, FlowEntry] = {
        flow: {"outcome": "error", "status": "missing", "message": "not reported"} for flow in FLOWS
    }
    for entry in entries:
        flow = entry.get("flow")
        if flow not in summary:
            continue
        status = entry.get("status", "unknown")
        lowered = status.lower()
        if lowered in {"ok", "pass", "passed", "success", "succeeded", "complete"}:
            outcome: Literal["ok", "warning", "error"] = "ok"
        elif lowered in {"warn", "warning", "skipped"}:
            outcome = "warning"
        else:
            outcome = "error"
        summary[flow] = {
            "outcome": outcome,
            "status": status,
            "message": entry.get("message", ""),
        }
    return summary


def _ordered(summary: dict[str, FlowEntry], focus: Sequence[str] | None) -> list[tuple[str, FlowEntry]]:
    keys: list[str]
    if focus:
        requested = {flow for flow in focus if flow in summary}
        keys = [flow for flow in FLOWS if flow in requested]
    else:
        keys = list(FLOWS)
    if not keys:
        keys = list(FLOWS)
    return [(flow, summary[flow]) for flow in keys]


def _write_report(root: Path, rows: Sequence[tuple[str, FlowEntry]]) -> None:
    report = root / REPORT_PATH
    report.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# Day8 CI reflection", "", "| Flow | Status | Message |", "| --- | --- | --- |"]
    for flow, entry in rows:
        message = entry["message"] if entry["message"] else "-"
        lines.append(f"| {flow} | {entry['status']} | {message} |")
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _write_issue(root: Path, rows: Sequence[tuple[str, FlowEntry]]) -> None:
    issue = root / ISSUE_PATH
    issue.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# Issue suggestions", ""]
    for flow, entry in rows:
        if entry["outcome"] == "ok":
            continue
        lines.append(f"- {flow}: {entry['status']} {entry['message']}".rstrip())
    if len(lines) == 2:
        lines.append("- none")
    issue.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _write_birdseye(root: Path, summary: dict[str, FlowEntry], totals: dict[str, int]) -> None:
    capsule = root / BIRDSEYE_PATH
    capsule.parent.mkdir(parents=True, exist_ok=True)
    payload = {"capsule": "day8-ci", "flows": summary, "totals": totals}
    capsule.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Analyze Day8 CI logs and emit reports")
    parser.add_argument("--root", default=".", help="Repository root to inspect")
    parser.add_argument("--emit", choices=("report", "json", "birdseye"), nargs="+", default=("report",))
    parser.add_argument("--focus", nargs="*", help="Subset of flows to report")
    parser.add_argument("--log", help="Override log path relative to root")
    parser.add_argument("--fail-on", choices=("warnings", "errors"), dest="fail_on")
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()
    log = Path(args.log) if args.log else root / DEFAULT_LOG
    if not log.is_absolute():
        log = root / log
    summary = _summarize(_load(log))
    rows = _ordered(summary, list(args.focus) if args.focus else None)
    totals = {level: sum(1 for entry in summary.values() if entry["outcome"] == level) for level in ("ok", "warning", "error")}
    if "json" in args.emit:
        print(json.dumps({"flows": summary, "totals": totals}, ensure_ascii=False))
    if "report" in args.emit:
        _write_report(root, rows)
        _write_issue(root, rows)
    if "birdseye" in args.emit:
        _write_birdseye(root, summary, totals)
    if args.fail_on == "warnings" and any(e["outcome"] != "ok" for e in summary.values()):
        return 1
    if args.fail_on == "errors" and any(e["outcome"] == "error" for e in summary.values()):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
