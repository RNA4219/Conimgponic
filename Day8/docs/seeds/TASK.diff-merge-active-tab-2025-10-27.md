---
task_id: 20251027-01
repo: Conimgponic
base_branch: main
work_branch: work/diff-merge-active-tab
priority: P2
langs:
  - TypeScript
  - Markdown
status: planned
last_reviewed_at: 2025-10-27
next_review_due: 2025-11-03
---

## Objective
DiffMergeView から createDiffMergeController へアクティブタブ解決関数を供給し、テレメトリ lastTab を選択タブと同期させる。

## Scope
### In
- src/components/DiffMergeView.tsx
- tests/components/DiffMergeView.test.tsx
### Out
- diffMergeReducer のイベント種別や Queue コマンド契約の変更
- 既存テレメトリ surface 名称の変更

## Requirements
### Behavior
- queueMergeCommand へ渡す telemetryContext.lastTab が UI の選択タブを常に指す。
- createDiffMergeController の呼び出しは resolveCurrentTab を受け取り、tab 切替で即時反映する。
### Constraints
- Day8/workflow-cookbook/GUARDRAILS.md の型安全・最小差分指針を遵守する。
- 既存 API シグネチャ（DiffMergeViewProps など）は変更しない。
### Acceptance
- テスト `pnpm test -- --filter diff-merge-view-state` と `pnpm test tests/components/DiffMergeView.test.tsx` が成功する。

## Affected Paths
- src/components/DiffMergeView.tsx
- tests/components/DiffMergeView.test.tsx

## Local Commands
- pnpm test -- --filter diff-merge-view-state
- pnpm test tests/components/DiffMergeView.test.tsx

## Deliverables
- テレメトリ lastTab の同期を検証するユニットテスト
- resolveCurrentTab を接続した最小差分の実装

## Plan
1. DiffMergeView の controller 生成で resolveCurrentTab を渡すためのメモ化依存関係を確認し、activeTab 変化を取り込む。workflow-cookbook/HUB.codex.md の自動タスク分割要件に合わせ最小差分を保持する。
2. DiffMergeView テストに telemetryContext.lastTab が選択タブを反映するアサーションを追加し、Day8/docs/TASKS.md の Seed 運用フローに沿って検証ログを残す。
3. 実装が queueMergeCommand に渡す lastTab を更新することを確認し、ガードレールで要求されるテストコマンドを実行して成功結果を記録する。

## Tests
- [x] pnpm test -- --filter diff-merge-view-state
- [x] pnpm test tests/components/DiffMergeView.test.tsx

## Commands
- [x] pnpm test -- --filter diff-merge-view-state
- [x] pnpm test tests/components/DiffMergeView.test.tsx

## Notes
- なし
