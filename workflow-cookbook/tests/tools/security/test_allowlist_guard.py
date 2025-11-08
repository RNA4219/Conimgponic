import sys
import textwrap
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if (repo_root := str(REPO_ROOT)) not in sys.path:
    sys.path.insert(0, repo_root)

# ruff: noqa: E402

from types import SimpleNamespace

import pytest

from tools.security import allowlist_guard
from tools.security.allowlist_guard import (
    AllowlistDocument,
    AllowlistEntry,
    AllowlistLoader,
    Purpose,
    _load_document_for_testing,
    detect_violations,
)


BASE_ALLOWLIST = textwrap.dedent(
    """
    allowlist:
      - domain: 'kept.example.com'
        owner: 'SecOps'
        purposes:
          - id: 'ci'
      - domain: 'removed.example.com'
        purposes:
          - id: 'deploy'
    """
)


def _expected_base_document() -> AllowlistDocument:
    return AllowlistDocument(
        entries=(
            AllowlistEntry(
                domain="kept.example.com",
                fields=(("owner", "SecOps"),),
                purposes=(Purpose(id="ci", fields=()),),
            ),
            AllowlistEntry(
                domain="removed.example.com",
                fields=(),
                purposes=(Purpose(id="deploy", fields=()),),
            ),
        )
    )


def test_allowlist_loader_uses_yaml_when_available(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_yaml = SimpleNamespace(safe_load=lambda _: {
        "allowlist": [
            {
                "domain": "kept.example.com",
                "owner": "SecOps",
                "purposes": [
                    {
                        "id": "ci",
                    }
                ],
            },
            {
                "domain": "removed.example.com",
                "purposes": [
                    {
                        "id": "deploy",
                    }
                ],
            },
        ]
    })

    loader = AllowlistLoader(fake_yaml)

    document = loader.load(BASE_ALLOWLIST)

    assert document == _expected_base_document()


def test_allowlist_loader_falls_back_without_yaml(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(allowlist_guard, "yaml", None, raising=False)

    loader = AllowlistLoader(None)

    document = loader.load(BASE_ALLOWLIST)

    assert document == _expected_base_document()


def test_allowlist_loader_raises_for_invalid_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(allowlist_guard, "yaml", None, raising=False)
    loader = AllowlistLoader(None)
    invalid_content = textwrap.dedent(
        """
        allowlist:
          - owner: 'SecOps'
        """
    )

    with pytest.raises(ValueError, match="expected domain entry"):
        loader.load(invalid_content)


def test_data_model_is_consistent_between_yaml_and_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    content = textwrap.dedent(
        """
        version: 1
        allowlist:
          - domain: 'example.com'
            owner: 'SecOps'
            purposes:
              - id: 'ci'
                runtime: ['ci']
        """
    )

    yaml_payload = {
        "version": 1,
        "allowlist": [
            {
                "domain": "example.com",
                "owner": "SecOps",
                "purposes": [
                    {
                        "id": "ci",
                        "runtime": ["ci"],
                    }
                ],
            }
        ],
    }

    monkeypatch.setattr(
        allowlist_guard,
        "yaml",
        SimpleNamespace(safe_load=lambda raw: yaml_payload),
        raising=False,
    )
    yaml_document = _load_document_for_testing(content)

    monkeypatch.setattr(allowlist_guard, "yaml", None, raising=False)
    fallback_document = _load_document_for_testing(content)

    assert yaml_document == fallback_document


def test_allowlist_entry_diff_helpers() -> None:
    entry = AllowlistEntry(
        domain="example.com",
        fields=(
            ("owner", "SecOps"),
            ("note", "keep"),
        ),
        purposes=(
            Purpose(id="ci", fields=(("runtime", ("ci",)),)),
        ),
    )
    modified = AllowlistEntry(
        domain="example.com",
        fields=(("owner", "Platform"),),
        purposes=(
            Purpose(id="ci", fields=(("runtime", ("deploy",)),)),
            Purpose(id="ops", fields=()),
        ),
    )

    assert entry.field_differences(modified) == ["note", "owner"]
    added, removed = entry.compare_purposes(modified)

    assert sorted(added) == ["ops"]
    assert removed == []
    assert modified.purposes_by_id()["ci"].fields != entry.purposes_by_id()["ci"].fields


def test_cli_returns_error_on_unapproved_domain(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    allowlist_path = tmp_path / "allowlist.yaml"
    base_content = textwrap.dedent(
        """
        allowlist:
          - domain: 'allowed.example.com'
            owner: 'SecOps'
        """
    )
    current_content = textwrap.dedent(
        """
        allowlist:
          - domain: 'allowed.example.com'
            owner: 'Platform'
          - domain: 'evil.example.com'
            owner: 'Unknown'
        """
    )
    allowlist_path.write_text(current_content)

    monkeypatch.setattr(allowlist_guard, "_git_show", lambda ref: base_content)
    monkeypatch.setattr(
        allowlist_guard,
        "_parse_args",
        lambda argv: SimpleNamespace(base_ref="origin/main", allowlist_path=allowlist_path),
    )

    exit_code = allowlist_guard.main([])
    captured = capsys.readouterr()

    assert exit_code == 1
    assert (
        "allowlist-guard: domain 'allowed.example.com' field 'owner' changed"
        in captured.out.splitlines()
    )
    assert (
        "allowlist-guard: domain 'evil.example.com' added without approval"
        in captured.out.splitlines()
    )
def test_detects_unapproved_domain_addition() -> None:
    allowlist_path = REPO_ROOT / "network" / "allowlist.yaml"
    base_content = allowlist_path.read_text()
    malicious_entry = (
        "\n"
        "  - domain: \"evil.example.com\"\n"
        "    owner: \"Unknown\"\n"
        "    purposes:\n"
        "      - id: \"ci\"\n"
        "        description: \"Unapproved access\"\n"
        "        runtime: [\"ci\"]\n"
    )
    current_content = base_content.rstrip() + malicious_entry

    violations = detect_violations(
        base_content=base_content, current_content=current_content
    )

    expected_message = "domain 'evil.example.com' added without approval"

    assert expected_message in violations


def test_detects_domain_field_changes() -> None:
    base_content = textwrap.dedent(
        """
        allowlist:
          - domain: 'kept.example.com'
            owner: 'SecOps'
            purposes:
              - id: 'ci'
        """
    )
    current_content = textwrap.dedent(
        """
        allowlist:
          - domain: 'kept.example.com'
            owner: 'Platform'
            purposes:
              - id: 'ci'
        """
    )

    violations = detect_violations(
        base_content=base_content,
        current_content=current_content,
    )

    assert violations == ["domain 'kept.example.com' field 'owner' changed"]


def test_detects_purpose_field_change() -> None:
    base_content = textwrap.dedent(
        """
        allowlist:
          - domain: 'kept.example.com'
            purposes:
              - id: 'ci'
                runtime: ['ci']
        """
    )
    current_content = textwrap.dedent(
        """
        allowlist:
          - domain: 'kept.example.com'
            purposes:
              - id: 'ci'
                runtime: ['deploy']
        """
    )

    violations = detect_violations(
        base_content=base_content,
        current_content=current_content,
    )

    assert violations == [
        "domain 'kept.example.com' purpose 'ci' changed fields: runtime"
    ]


@pytest.mark.parametrize(
    "current_content",
    [
        textwrap.dedent(
            """
            allowlist:
              - domain: 'kept.example.com'
                owner: 'Platform'
                purposes:
                  - id: 'ci'
              - domain: 'removed.example.com'
                purposes:
                  - id: 'deploy'
            """
        ),
        textwrap.dedent(
            """
            allowlist:
              - domain: 'kept.example.com'
                purposes:
                  - id: 'ci'
              - domain: 'removed.example.com'
                purposes:
                  - id: 'deploy'
            """
        ),
    ],
)
def test_detects_owner_change_violations(current_content: str) -> None:
    violations = detect_violations(
        base_content=BASE_ALLOWLIST,
        current_content=current_content,
    )

    assert "domain 'kept.example.com' field 'owner' changed" in violations


@pytest.mark.parametrize(
    ("current_content", "expected_fragment"),
    [
        (
            textwrap.dedent(
                """
                allowlist:
                  - domain: 'kept.example.com'
                    purposes:
                      - id: 'ci'
                """
            ),
            "domain 'removed.example.com' removed without approval",
        ),
        (
            textwrap.dedent(
                """
                allowlist:
                  - domain: 'kept.example.com'
                    purposes:
                      - id: 'ci'
                  - domain: 'removed.example.com'
                    purposes:
                """
            ),
            "domain 'removed.example.com' purpose 'deploy' removed without approval",
        ),
    ],
)
def test_detects_unapproved_deletions(current_content: str, expected_fragment: str) -> None:
    violations = detect_violations(
        base_content=BASE_ALLOWLIST,
        current_content=current_content,
    )

    assert any(expected_fragment in message for message in violations)


def test_cli_returns_error_on_removed_domain(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    allowlist_path = tmp_path / "allowlist.yaml"
    current_content = textwrap.dedent(
        """
        allowlist:
          - domain: 'kept.example.com'
            purposes:
              - id: 'ci'
        """
    )
    allowlist_path.write_text(current_content)

    monkeypatch.setattr(allowlist_guard, "_git_show", lambda ref: BASE_ALLOWLIST)
    monkeypatch.setattr(
        allowlist_guard,
        "_parse_args",
        lambda argv: SimpleNamespace(base_ref="origin/main", allowlist_path=allowlist_path),
    )

    exit_code = allowlist_guard.main([])
    captured = capsys.readouterr()

    assert exit_code == 1
    assert (
        "allowlist-guard: domain 'removed.example.com' removed without approval"
        in captured.out.splitlines()
    )
