# Task Seed

## メタデータ

```yaml
task_id: 20251031-03
repo: local://Conimgponic
base_branch: work
work_branch: feat/diff-merge-hunk-selection
priority: P1
langs: [typescript]
status: draft
last_reviewed_at: 2025-10-31
next_review_due: 2025-11-14
```

## Objective

DiffMerge の `syncHunks` が新規ハンク追加時も既存ハンクの選択・編集状態を保持することを Day8/workflow-cookbook/HUB.codex.md と Day8/docs/TASKS.md の要件整理に沿って検証する。

## Scope

- In: `tests/merge/diff-merge-view-state.test.ts`, `src/components/diffMergeState.ts`
- Out: `DiffMergeView` の UI 実装、他 reducer 分岐

## Requirements

- Behavior:
  - 既存ハンクが `Selected` の状態で `syncHunks` に新規ハンクが加わっても選択状態が保持されること。
  - `editingHunkId` が既知ハンクを指している場合、`syncHunks` 後も維持されること。
  - Guardrails（Day8/workflow-cookbook/GUARDRAILS.md）の「型安全・最小差分・TDD」を遵守し、先に赤テストを追加してから実装すること。
- Constraints:
  - 既存 reducer シグネチャを変更しない。
  - 新規ハンクのみ初期状態（`Unreviewed`）にセットする。
- Acceptance Criteria:
  - 新規テストが選択・編集状態保持をカバーし、`pnpm test -- --filter diff-merge-view-state` がグリーンとなる。

## Affected Paths

- tests/merge/diff-merge-view-state.test.ts
- src/components/diffMergeState.ts

## Local Commands

```bash
pnpm test -- --filter diff-merge-view-state
```

## Deliverables

- PR: `syncHunks` の状態保持をテスト駆動で実装、Intent: INT-001、リスク評価、テストログ
- Artifacts: `pnpm test -- --filter diff-merge-view-state` の実行ログ

---

## Plan

1. Day8/workflow-cookbook/GUARDRAILS.md の「型安全・最小差分・TDD」を引用しつつ、既存ハンク選択維持の赤テストを `tests/merge/diff-merge-view-state.test.ts` に追加する。
2. `src/components/diffMergeState.ts` の `syncHunks` 分岐を修正し、既知ハンクのステータスと `editingHunkId` を保持しつつ未知ハンクを初期化する。
3. `pnpm test -- --filter diff-merge-view-state` を実行し、緑化結果を Tests / Commands セクションへ記録する。

## Patch

- 2025-10-31: `syncHunks` の既知ハンク状態保持と新規ハンク初期化を実装し、テストを追加。

## Tests

- 2025-10-31: `TS_NODE_TRANSPILE_ONLY=1 pnpm test -- --filter diff-merge-view-state`（緑）

## Commands

- 2025-10-31: `TS_NODE_TRANSPILE_ONLY=1 pnpm test -- --filter diff-merge-view-state`

## Notes

### Rationale

- ハンク追加時に選択状態が失われるとレビュー効率が低下するため。

### Risks

- 既知ハンクの状態更新が漏れると旧ステータスが残り続ける可能性。

### Follow-ups

- `syncHunks` と他アクション間の整合テスト拡充を検討。
