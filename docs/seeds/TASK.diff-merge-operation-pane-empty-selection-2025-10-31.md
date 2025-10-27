# Task Seed

## メタデータ

```yaml
task_id: 20251031-02
repo: local://Conimgponic
base_branch: work
work_branch: feat/diff-merge-operation-pane-empty-selection
priority: P1
langs: [typescript]
status: in_progress
last_reviewed_at: 2025-10-31
next_review_due: 2025-11-14
```

## Objective

OperationPane で選択数 0 件の場合に queueMerge が起動しないことを赤テストで保証し、TDD で回帰防止を図る。

## Scope

- In: `tests/merge/diff-merge-view-state.test.ts`, `src/components/DiffMergeView.tsx`
- Out: `diffMergeState` 制御ロジック全般、MergeDock 統合、他ビューの選択制御

## Requirements

- Behavior:
  - `DiffMergeView` の OperationPane は選択ハンクが 0 件のときボタンを無効化し、`queueMerge` が発火しないことを示す赤テストを追加する。
- Constraints:
  - Day8 Guardrails（`workflow-cookbook/GUARDRAILS.md`）と Contributing ガイド（`docs/day8/guides/07_contributing.md`）に沿ってテストを先行し、最小差分で実装する。
- Acceptance Criteria:
  - 新規テストがバグを再現し、修正後に `pnpm test -- --filter diff-merge-view-state` が成功する。

## Affected Paths

- tests/merge/diff-merge-view-state.test.ts
- src/components/DiffMergeView.tsx

## Local Commands

```bash
pnpm test -- --filter diff-merge-view-state
```

## Deliverables

- OperationPane の空選択防止を検証する赤テストと最小限の修正。
- 上記コマンドの検証ログとフォローアップ有無の記録。

---

## Plan

1. `DiffMergeView` OperationPane の空選択時ボタン状態を検証する赤テストを追加し、Guardrails/Contributing の TDD 指針を満たす。
2. テストが失敗することを確認後、`queueCandidateIds` を選択 ID のみに限定し、空選択時はボタンを無効化する。
3. `pnpm test -- --filter diff-merge-view-state` を実行して修正を確認し、結果を Tests/Commands に追記する。

## Patch

- OperationPane 赤テストと空選択防止ロジックの実装。

## Tests

- 2025-10-31: `pnpm test -- --filter diff-merge-view-state` → `tests/components/DiffMergeView.test.tsx` が `[Object: null prototype]` 例外で失敗（ts-node/esm 起動既知事象、Guardrails に従いフォローアップ継続）。

## Commands

- `pnpm test -- --filter diff-merge-view-state`

## Notes

### Follow-ups

- 現行 UI で空選択時のヒント表示が不足しているため、ツールチップ追加可否を後続タスクで検討する。
