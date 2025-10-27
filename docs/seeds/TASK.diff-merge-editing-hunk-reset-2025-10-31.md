# Task Seed

## メタデータ

```yaml
task_id: 20251031-02
repo: local://Conimgponic
base_branch: work
work_branch: feat/diff-merge-editing-hunk-reset
priority: P1
langs: [typescript]
status: draft
last_reviewed_at: 2025-10-31
next_review_due: 2025-11-14
```

## Objective

DiffMerge の編集モード中に `queueMerge` / `queueResult` が発火した場合でも `editingHunkId` を確実に解除する TDD 先行タイトスコープの検証タスク。

## Scope

- In: `tests/merge/diff-merge-view-state.test.ts`, `src/components/diffMergeState.ts`
- Out: `DiffMergeView` UI 構造、他 reducer ロジック

## Requirements

- Behavior:
  - 編集モード (`editingHunkId`) がセットされた状態で `queueMerge` または `queueResult` が対象ハンクを処理するとき、`editingHunkId` は `null` に戻ること。
  - Guardrails（Day8/workflow-cookbook/GUARDRAILS.md）の「型安全・最小差分・TDD」を遵守し、先に赤テストを追加すること。
  - `cancelEdit` アクションで編集中ハンクが `'Unreviewed'` に戻り、`editingHunkId` が `null` へ遷移する idle ケースをテストで確認すること。
- Constraints:
  - 既存 reducer シグネチャを変更しない。
  - 対象ハンクの判定は既存の known hunk フロー (`retainKnownHunkIds`) を活用する。
- Acceptance Criteria:
  - 新規テストが reducer の期待挙動をカバーし、`pnpm test -- --filter diff-merge-view-state` がグリーン。

## Affected Paths

- tests/merge/diff-merge-view-state.test.ts
- src/components/diffMergeState.ts

## Local Commands

```bash
pnpm test -- --filter diff-merge-view-state
```

## Deliverables

- PR: DiffMerge 編集モード解除のテスト駆動実装、Intent: INT-001、リスク評価、テストログ
- Artifacts: テストログ（`pnpm test -- --filter diff-merge-view-state`）

---

## Plan

1. `tests/merge/diff-merge-view-state.test.ts` に編集モード中の `queueMerge` / `queueResult` が `editingHunkId` を `null` にする赤テストを Day8/docs/TASKS.md に沿って追加する。
2. 同テストファイルへ `cancelEdit` の idle 遷移を確認し対象ハンクが `'Unreviewed'` に戻ることを保証する赤テストを追記し、Day8/workflow-cookbook/HUB.codex.md のタスク分割フローと整合する検証観点を固める。
3. `diffMergeReducer` の `queueMerge` / `queueResult` 分岐で対象ハンクを検出し、Guardrails の「型安全・最小差分・TDD」を引用したコメントを添えて `editingHunkId` を `null` にする実装を追加する。
4. `pnpm test -- --filter diff-merge-view-state` を実行し、緑化ログを Tests セクションに記録する。

## Patch

- 2025-10-31: `queueMerge` / `queueResult` で対象ハンクを追跡するヘルパーを追加し、編集モーダルが閉じることを検証する回帰テストを追加。

## Tests

- 2025-10-31: `TS_NODE_TRANSPILE_ONLY=1 pnpm test -- --filter diff-merge-view-state`（初回・緑）
- 2025-10-31: `pnpm tsx tests/merge/diff-merge-view-state.test.ts`（緑）
- 2025-10-31: `pnpm test -- --filter diff-merge-view-state`（`ts-node/esm` が `.tsx` を解決できず失敗）
- 2025-10-31: `TS_NODE_TRANSPILE_ONLY=1 pnpm test -- --filter diff-merge-view-state`（再実行・緑）
- 2025-10-27: `TS_NODE_TRANSPILE_ONLY=1 pnpm tsx tests/merge/diff-merge-view-state.test.ts`（赤: `cancelEdit` が `'Unreviewed'` に戻らず失敗）
- 2025-10-27: `TS_NODE_TRANSPILE_ONLY=1 pnpm tsx tests/merge/diff-merge-view-state.test.ts`（緑: `cancelEdit` 状態リセット修正後）
- 2025-10-27: `pnpm test -- --filter diff-merge-view-state`（赤: `ts-node/esm` ローダーの制約で失敗）
- 2025-10-27: `TS_NODE_TRANSPILE_ONLY=1 pnpm test -- --filter diff-merge-view-state`（緑: フィルタ実行成功）

## Commands

- 2025-10-31: `TS_NODE_TRANSPILE_ONLY=1 pnpm test -- --filter diff-merge-view-state`（初回）
- 2025-10-31: `pnpm tsx tests/merge/diff-merge-view-state.test.ts`
- 2025-10-31: `pnpm test -- --filter diff-merge-view-state`
- 2025-10-31: `TS_NODE_TRANSPILE_ONLY=1 pnpm test -- --filter diff-merge-view-state`（再実行）
- 2025-10-27: `TS_NODE_TRANSPILE_ONLY=1 pnpm tsx tests/merge/diff-merge-view-state.test.ts`
- 2025-10-27: `pnpm test -- --filter diff-merge-view-state`
- 2025-10-27: `TS_NODE_TRANSPILE_ONLY=1 pnpm test -- --filter diff-merge-view-state`

## Notes

### Rationale

- 編集モードが残存すると操作ペインが stale なハンクを編集し続けるリスクを排除するため。

### Risks

- 対象ハンク判定に漏れがあると編集解除されないケースが残る可能性。

### Follow-ups

- reducer の編集モード遷移を網羅する追加ケース（`cancelEdit` 等）のテスト拡充を検討。
