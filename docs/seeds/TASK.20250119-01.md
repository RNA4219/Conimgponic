# Task Seed

## メタデータ

```yaml
task_id: 20250119-01
repo: local://Conimgponic
base_branch: main
work_branch: feat/autosave-flags-design
priority: P1
langs: [typescript]
```

## Objective

src/config/flags.ts で `autosave.enabled` と `merge.precision` を env→localStorage→既定値の優先順位で解決し、ソースメタ付き `FlagSnapshot` を確定する。

## Scope

- In: `src/config/flags.ts`, `docs/CONFIG_FLAGS.md`, `tests/config/FLAGS_TEST_PLAN.md`
- Out: AutoSave 実装・Diff Merge UI 実装・CLI 変更

## Requirements

- Behavior:
  - env → localStorage → 既定値の順で評価し、`FlagValueSnapshot` にソースと検証エラーを同梱する。
  - 既定値（`DEFAULT_FLAGS`）を更新しても Phase A/B の互換性が保たれること。
- I/O Contract:
  - Input: `import.meta.env`, `localStorage`, `DEFAULT_FLAGS`
  - Output: `FlagSnapshot`（autosave/merge それぞれに `value`・`source`・`errors`）
- Constraints:
  - 既存 API を破壊せず、段階的なフラグ移行に備える。
  - Lint / Type / Test はゼロエラー。
- Acceptance Criteria:
  - 設計レビューでフラグ解決シーケンスと `DEFAULT_FLAGS` の整合が承認される。
  - App.tsx / MergeDock.tsx 利用シナリオを網羅したテスト計画が提示される。

## Affected Paths

- src/config/flags.ts
- docs/CONFIG_FLAGS.md
- tests/config/FLAGS_TEST_PLAN.md

## Local Commands（存在するものだけ実行）

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Deliverables

- PR: 設計サマリ、影響範囲、ロールバック方針、`Intent: INT-001`
- Artifacts: 設計ドキュメント差分、テスト計画更新、必要に応じたテレメトリ補足

---

## Plan

### Steps

1) 既存 `resolveFlag` / `resolveFlags` の挙動と docs/CONFIG_FLAGS.md を読み合わせる。
2) `DEFAULT_FLAGS` を定義し、`FlagValueSnapshot` 経由でソース・エラーを保持できるよう型と実装を更新する。
3) App/Merge 用シナリオを `tests/config/FLAGS_TEST_PLAN.md` に追加し、Phase 互換をレビュー項目に含める。
4) `pnpm lint && pnpm typecheck && pnpm test` を実行し、ゼロエラーを確認する。
5) 設計差分を共有し、後続実装タスクの準備を整える。

## Patch

_(設計タスクのため省略。実装は後続タスクで管理)_

## Tests

### Outline

- Unit:
  - env 優先で `autosave.enabled` が `env` ソースになる。
  - localStorage 優先で `merge.precision` が `localStorage` ソースになる。
- Integration:
  - `resolveFlags()` を介した App.tsx / MergeDock.tsx 起動シナリオのフラグ反映。

## Commands

### Run gates

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

## Notes

### Rationale

- env→localStorage→既定値を統一し、UI 層からの直接 `localStorage` 参照を段階的に排除する。

### Risks

- 既定値更新時に `DEFAULT_FLAGS` と docs の乖離が生じるリスクがあるため、レビューで同期確認を必須化する。

### Follow-ups

- AutoSave 起動フローと Diff Merge UI での FlagSnapshot 利用実装（別タスク）。
