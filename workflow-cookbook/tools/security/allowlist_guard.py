from __future__ import annotations

import argparse
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

try:
    import yaml  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - fallback for minimal env
    yaml = None  # type: ignore[assignment]


@dataclass(frozen=True)
class Purpose:
    id: str
    fields: tuple[tuple[str, Any], ...] = field(default_factory=tuple)

    @classmethod
    def from_mapping(cls, mapping: Mapping[str, Any]) -> "Purpose":
        identifier = mapping.get("id")
        if not isinstance(identifier, str):
            raise ValueError("purpose id must be a string")
        return cls(id=identifier, fields=_normalize_fields(mapping, {"id"}))

    def field_differences(self, other: "Purpose") -> list[str]:
        return _diff_fields(dict(self.fields), dict(other.fields))


@dataclass(frozen=True)
class AllowlistEntry:
    domain: str
    fields: tuple[tuple[str, Any], ...] = field(default_factory=tuple)
    purposes: tuple[Purpose, ...] = field(default_factory=tuple)

    @classmethod
    def from_mapping(cls, mapping: Mapping[str, Any]) -> "AllowlistEntry":
        domain = mapping.get("domain")
        if not isinstance(domain, str):
            raise ValueError("allowlist entry missing domain")
        raw_purposes = mapping.get("purposes", [])
        if raw_purposes in (None, ""):
            raw_purposes = []
        if not isinstance(raw_purposes, list):
            raise ValueError("purposes must be a list")
        purposes = tuple(Purpose.from_mapping(p) for p in raw_purposes if isinstance(p, Mapping))
        if len(purposes) != len(raw_purposes):
            raise ValueError("purposes entries must be mappings")
        return cls(
            domain=domain,
            fields=_normalize_fields(mapping, {"domain", "purposes"}),
            purposes=tuple(sorted(purposes, key=lambda item: item.id)),
        )

    def field_differences(self, other: "AllowlistEntry") -> list[str]:
        return _diff_fields(dict(self.fields), dict(other.fields))

    def purposes_by_id(self) -> dict[str, Purpose]:
        return {purpose.id: purpose for purpose in self.purposes}

    def compare_purposes(self, other: "AllowlistEntry") -> tuple[list[str], list[str]]:
        base_ids = set(p.id for p in self.purposes)
        current_ids = set(p.id for p in other.purposes)
        added = sorted(current_ids - base_ids)
        removed = sorted(base_ids - current_ids)
        return added, removed


@dataclass(frozen=True)
class AllowlistDocument:
    entries: tuple[AllowlistEntry, ...]
    version: int | None = None

    def entries_by_domain(self) -> dict[str, AllowlistEntry]:
        return {entry.domain: entry for entry in self.entries}


class AllowlistLoader:
    def __init__(self, yaml_module: Any | None) -> None:
        self._yaml_module = yaml_module
        self._allowlist: list[dict[str, Any]] = []
        self._version: int | None = None
        self._current_entry: dict[str, Any] | None = None
        self._current_purpose: dict[str, Any] | None = None

    def load(self, content: str) -> AllowlistDocument:
        if self._yaml_module is not None:
            loaded = self._yaml_module.safe_load(content)  # type: ignore[attr-defined]
            mapping = loaded if isinstance(loaded, Mapping) else {}
            return _document_from_raw(mapping)
        return self._load_with_fallback(content)

    def _reset_state(self) -> None:
        self._allowlist = []
        self._version = None
        self._current_entry = None
        self._current_purpose = None

    def _load_with_fallback(self, content: str) -> AllowlistDocument:
        self._reset_state()
        for raw in content.splitlines():
            line = raw.split("#", 1)[0].rstrip()
            if not line.strip():
                continue
            indent = len(raw) - len(raw.lstrip(" "))
            if indent == 0:
                key, _, rest = line.partition(":")
                key = key.strip()
                value = rest.strip()
                if key == "version" and value:
                    self._version = int(value)
                continue
            if indent == 2:
                if line.strip().startswith("- "):
                    key, _, rest = line.strip()[2:].partition(":")
                    if key.strip() != "domain":
                        raise ValueError("expected domain entry")
                    self._current_entry = {"domain": _strip_quotes(rest.strip()), "purposes": []}
                    self._allowlist.append(self._current_entry)
                    self._current_purpose = None
                    continue
            if indent == 4 and self._current_entry is not None:
                key, _, rest = line.partition(":")
                key = key.strip()
                value = rest.strip()
                if key == "owner":
                    self._current_entry["owner"] = _strip_quotes(value)
                elif key == "purposes":
                    continue
                else:
                    self._current_entry[key] = _strip_quotes(value)
                continue
            if indent == 6 and self._current_entry is not None:
                if line.strip().startswith("- "):
                    key, _, rest = line.strip()[2:].partition(":")
                    if key.strip() != "id":
                        raise ValueError("expected purpose id")
                    self._current_purpose = {"id": _strip_quotes(rest.strip())}
                    self._current_entry.setdefault("purposes", []).append(self._current_purpose)
                    continue
                key, _, rest = line.partition(":")
                if self._current_purpose is None:
                    continue
                key = key.strip()
                value = rest.strip()
                self._current_purpose[key] = _strip_quotes(value)
                continue
            if indent == 8 and self._current_purpose is not None:
                key, _, rest = line.partition(":")
                key = key.strip()
                value = rest.strip()
                if key == "runtime":
                    self._current_purpose[key] = _parse_inline_list(value)
                else:
                    self._current_purpose[key] = _strip_quotes(value)
        raw_document: dict[str, Any] = {"allowlist": self._allowlist}
        if self._version is not None:
            raw_document["version"] = self._version
        return _document_from_raw(raw_document)


def _strip_quotes(value: str) -> str:
    if (value.startswith("\"") and value.endswith("\"")) or (
        value.startswith("'") and value.endswith("'")
    ):
        return value[1:-1]
    return value


def _parse_inline_list(value: str) -> list[str]:
    stripped = value.strip()
    if not stripped:
        return []
    if stripped.startswith("[") and stripped.endswith("]"):
        body = stripped[1:-1].strip()
        if not body:
            return []
        return [
            _strip_quotes(part.strip())
            for part in body.split(",")
            if part.strip()
        ]
    return [_strip_quotes(stripped)]


def _normalize_value(value: Any) -> Any:
    if isinstance(value, (list, tuple)):
        return tuple(_normalize_value(item) for item in value)
    return value


def _normalize_fields(mapping: Mapping[str, Any], exclude: Iterable[str]) -> tuple[tuple[str, Any], ...]:
    excluded = set(exclude)
    items = []
    for key, value in mapping.items():
        if key in excluded:
            continue
        items.append((key, _normalize_value(value)))
    return tuple(sorted(items, key=lambda pair: pair[0]))


def _diff_fields(base: Mapping[str, Any], current: Mapping[str, Any]) -> list[str]:
    keys = set(base) | set(current)
    return sorted(key for key in keys if base.get(key) != current.get(key))


def _document_from_raw(raw: Mapping[str, Any] | None) -> AllowlistDocument:
    if raw is None:
        return AllowlistDocument(entries=())
    allowlist = raw.get("allowlist", [])
    if not isinstance(allowlist, list):
        raise ValueError("allowlist must be a list")
    entries = []
    for entry in allowlist:
        if not isinstance(entry, Mapping):
            raise ValueError("allowlist entries must be mappings")
        entries.append(AllowlistEntry.from_mapping(entry))
    version_value = raw.get("version")
    version = int(version_value) if isinstance(version_value, int) else None
    return AllowlistDocument(entries=tuple(sorted(entries, key=lambda item: item.domain)), version=version)
def _load_document_for_testing(content: str) -> AllowlistDocument:
    loader = AllowlistLoader(yaml)
    return loader.load(content)


def detect_violations(*, base_content: str, current_content: str) -> list[str]:
    loader = AllowlistLoader(yaml)
    base_doc = loader.load(base_content)
    current_doc = loader.load(current_content)
    violations: list[str] = []
    base_entries = base_doc.entries_by_domain()
    current_entries = current_doc.entries_by_domain()

    for domain, entry in current_entries.items():
        base_entry = base_entries.get(domain)
        if base_entry is None:
            violations.append(f"domain '{domain}' added without approval")
            continue
        for diff_field in base_entry.field_differences(entry):
            violations.append(f"domain '{domain}' field '{diff_field}' changed")
        base_purposes = base_entry.purposes_by_id()
        current_purposes = entry.purposes_by_id()
        for identifier, purpose in current_purposes.items():
            base_purpose = base_purposes.get(identifier)
            if base_purpose is None:
                violations.append(
                    f"domain '{domain}' purpose '{identifier}' added without approval"
                )
                continue
            changed_fields = base_purpose.field_differences(purpose)
            if changed_fields:
                detail = ", ".join(changed_fields)
                violations.append(
                    f"domain '{domain}' purpose '{identifier}' changed fields: {detail}"
                )

    for domain, base_entry in base_entries.items():
        if domain not in current_entries:
            violations.append(f"domain '{domain}' removed without approval")
            continue
        base_ids = base_entry.purposes_by_id()
        current_ids = current_entries[domain].purposes_by_id()
        for identifier in base_ids:
            if identifier not in current_ids:
                violations.append(
                    f"domain '{domain}' purpose '{identifier}' removed without approval"
                )
    return violations


def _git_show(ref: str) -> str:
    result = subprocess.run(
        ["git", "show", ref],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"failed to read {ref}")
    return result.stdout


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate network allowlist changes")
    parser.add_argument("--base-ref", required=True)
    parser.add_argument(
        "--allowlist-path",
        default=Path("network/allowlist.yaml"),
        type=Path,
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    allowlist_path = args.allowlist_path
    base_spec = f"{args.base_ref}:{allowlist_path.as_posix()}"
    base_content = _git_show(base_spec)
    current_content = allowlist_path.read_text()
    violations = detect_violations(base_content=base_content, current_content=current_content)
    for violation in violations:
        print(f"allowlist-guard: {violation}")
    return 1 if violations else 0


if __name__ == "__main__":
    raise SystemExit(main())
