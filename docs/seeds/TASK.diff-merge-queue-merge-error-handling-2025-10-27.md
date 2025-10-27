# Task Seed

## メタデータ

```yaml
task_id: 20251027-05
repo: local://Conimgponic
base_branch: work
work_branch: feat/diff-merge-queue-merge-error-handling
priority: P2
langs: [typescript]
status: draft
last_reviewed_at: 2025-10-27
next_review_due: 2025-11-10
```

## Objective

Day8/workflow-cookbook/HUB.codex.md のタスク分割フローと Day8/docs/TASKS.md の検証ログ指針に従い、`queueMergeCommand` が例外を投げても `createDiffMergeController.queueMerge` が reject しないことを確認するテスト計画と検証ログを整備する。

## Scope

- In: `tests/merge/diff-merge-view-state.test.ts`, `src/components/diffMergeState.ts`
- Out: `DiffMergeView` の UI レイヤ、OperationPane のテレメトリ

## Requirements

- Behavior:
  - Day8/workflow-cookbook/GUARDRAILS.md の TDD・型安全・最小差分原則に従い、`queueMergeCommand` が throw するケースで `queueMerge` が resolve し、`onError` による通知と `queueResult` の `error` ハンドリングのみで完結する赤テストを先に追加する。
  - Day8/docs/day8/guides/07_contributing.md の「1タスク=1PR」方針に基づき、追加テストと `queueMerge` の catch 節修正に作業スコープを限定する。
  - Day8/docs/TASKS.md の検証ログ手順を踏襲し、テスト結果とローカルコマンドを Tests/Commands セクションへ追記する。
- Constraints:
  - Markdown を除き、変更ファイルは 2 件以内とする。
  - 既存のテレメトリ payload 形状を変えない。
- Acceptance Criteria:
  - `queueMergeCommand` が throw した場合でも `queueMerge` が Promise rejection を発生させないことを確認する赤テストが存在する。
  - 修正後に `pnpm test -- --filter diff-merge-view-state` が未処理拒否なく完走し、結果を Seed に記録する。

## Affected Paths

- tests/merge/diff-merge-view-state.test.ts
- src/components/diffMergeState.ts

## Local Commands（存在するものだけ実行）

```bash
pnpm test -- --filter diff-merge-view-state
```

## Deliverables

- PR: queueMerge が例外時にも resolve することを保証する最小差分（Intent: INT-001）
- Artifacts: 赤テスト追加ログ、`pnpm test -- --filter diff-merge-view-state` の実行結果

---

## Plan

### Steps

1) Day8/workflow-cookbook/GUARDRAILS.md の TDD/最小差分ガイドと Day8/docs/day8/guides/07_contributing.md の 1PR 原則を引用しながら、`tests/merge/diff-merge-view-state.test.ts` に `queueMergeCommand` が throw しても未処理拒否にならないことを検証する赤テストを追加する。
2) 赤テストを実行して失敗ログを取得し、`queueMerge` の catch 節で再スローを排除する最小差分を `src/components/diffMergeState.ts` に適用する。
3) 修正後に `pnpm test -- --filter diff-merge-view-state` を実行し、未処理拒否が発生しないことを確認して Tests/Commands に記録する。

## Patch

- Pending: queueMerge catch 節から再スローを削除し、`onError` 通知と `queueResult` dispatch のみで完結させる。

## Tests

- 2025-10-27: `TS_NODE_TRANSPILE_ONLY=1 pnpm test -- --filter diff-merge-view-state`（緑、Promise 未処理拒否なし）
- 2025-10-31: `TS_NODE_TRANSPILE_ONLY=1 pnpm test -- --filter diff-merge-view-state`（緑、未処理拒否のイベント発生なし）

## Commands

- 2025-10-27: `TS_NODE_TRANSPILE_ONLY=1 pnpm test -- --filter diff-merge-view-state`
- 2025-10-31: `TS_NODE_TRANSPILE_ONLY=1 pnpm test -- --filter diff-merge-view-state`

## Notes

- Day8/docs/day8/guides/07_contributing.md の衝突回避指針に従い、他タスクとスコープが重複しないように seed を共有する。
