# Implementation Verification Plan

- Run lint (ruff, mypy) and fix issues within allowed scope.
- Run tests (pytest for Python, node:test for TS/JS) and ensure green.
- Ensure no public API breaks; if breaks, provide a clear migration plan.
- Verify type safety and runtime errors via CI.
- Document any deviations and rationale.
