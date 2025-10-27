# Task Seed

## メタデータ

```yaml
task_id: 20251031-01
repo: local://Conimgponic
base_branch: work
work_branch: feat/diff-merge-operation-pane-queue
priority: P2
langs: [typescript]
status: draft
last_reviewed_at: 2025-10-31
next_review_due: 2025-11-14
```

## Objective

`tests/merge/diff-merge-view-state.test.ts` に OperationPane 未選択時の安全装置を検証する赤テストを追加し、`DiffMergeView` のキュー動作を TDD で是正する。

## Scope

- In: `tests/merge/diff-merge-view-state.test.ts`, `src/components/DiffMergeView.tsx`
- Out: `diffMergeState.ts` の状態遷移ロジック、`MergeDock` サイドのタブ制御

## Requirements

- Behavior:
  - Day8/workflow-cookbook/HUB.codex.md の Task Seed 生成フローに従い、OperationPane が未選択時に `queueMerge` を実行しないことを明文化したテストを先行実装する。
  - Day8/docs/TASKS.md の検証ログ運用に従い、テストとローカルコマンド結果を Seed の Tests/Commands セクションへ追記する。
  - Day8/workflow-cookbook/GUARDRAILS.md の TDD・型安全・最小差分方針を踏まえ、`queueCandidateIds` を選択済みハンクに限定し、必要であれば OperationPane ボタンへ `disabled` を付与して未選択時の発火を防ぐ。
- Constraints:
  - 変更ファイルは 2 件以内（Markdown を除く）とし、Public API を破壊しない。
  - `DiffMergeView` の既存 Telemetry 契約（collector/analyzer surfaces, lastTab）を保持する。
- Acceptance Criteria:
  - 赤テストが追加され、未修正状態では失敗することを確認する。
  - 修正後に `pnpm test -- --filter diff-merge-view-state` がグリーンで完走し、Seed の Tests/Commands にログを残す。

## Affected Paths

- tests/merge/diff-merge-view-state.test.ts
- src/components/DiffMergeView.tsx

## Local Commands（存在するものだけ実行）

```bash
pnpm test -- --filter diff-merge-view-state
```

## Deliverables

- PR: OperationPane 未選択時のキュー防止（Intent: INT-001）
- Artifacts: 赤テスト追加ログ、`DiffMergeView` の最小差分

---

## Plan

### Steps

1) OperationPane の初期レンダリングを確認し、未選択時に `data-hunks="[]"` および `disabled` が付与されるべきことをテストケースとして明文化する。
2) 追加した赤テストを実行し、現状動作が期待に反してキュー対象へ全ハンクを含めていることを失敗として確認する。
3) `DiffMergeView.tsx` の `queueCandidateIds` を選択済みハンク ID のみに限定し、OperationPane ボタンに `disabled` ガードを付与する最小差分を適用する。
4) テストを再実行して緑化を確認し、結果を Tests/Commands セクションへ追記する。

## Patch

- 2025-10-31: `DiffMergeView` の `queueHunkIds` 計算を選択済みハンク限定に変更し、OperationPane ボタンへ `disabled` ガードを追加。
- 2025-10-27: OperationPane の `queueCandidateIds` を公開し、未選択時は `aria-disabled` 付きでキューを防止。

## Tests

- 2025-10-31: `pnpm test -- --filter diff-merge-view-state`（`ts-node/esm` が `.tsx` を解決できず失敗）
- 2025-10-31: `pnpm tsx tests/merge/diff-merge-view-state.test.ts`（緑）
- 2025-10-27: `pnpm tsx tests/merge/diff-merge-view-state.test.ts`（緑）
- 2025-10-27: `TS_NODE_TRANSPILE_ONLY=1 pnpm test -- --filter diff-merge-view-state`（緑）

## Commands

- 2025-10-31: `pnpm test -- --filter diff-merge-view-state`
- 2025-10-31: `pnpm tsx tests/merge/diff-merge-view-state.test.ts`
- 2025-10-27: `pnpm tsx tests/merge/diff-merge-view-state.test.ts`
- 2025-10-27: `TS_NODE_TRANSPILE_ONLY=1 pnpm test -- --filter diff-merge-view-state`

## Notes

- Day8/docs/day8/guides/07_contributing.md の「1タスク=1PR」原則を守り、当タスク専用ブランチで作業する。
