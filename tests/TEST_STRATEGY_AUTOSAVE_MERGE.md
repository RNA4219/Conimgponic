# Test Strategy: AutoSave & Merge

## Goals
- Validate AutoSave behaviors and Diff Merge consistency under concurrent edits.
- Establish testing framework alignment with repository rules (mypy/ruff/pytest).

## Reference Plans
- docs/TEST-PLAN.md
- autosave/TEST_PLAN.md (to be created)
- merge/TEST_PLAN.md (to be created)

## Suggested Test Approaches
- TDD-first: write tests before implementing features.
- Use snapshots for merge outcomes.
- Include CI integration tests.

## CI & Tooling
- pytest for Python tests
- node:test for JS/TS tests
- Linting with ruff/mypy where applicable
