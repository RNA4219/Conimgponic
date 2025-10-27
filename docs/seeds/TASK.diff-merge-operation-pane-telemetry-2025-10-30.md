# Task Seed

## メタデータ

```yaml
task_id: 20251030-01
repo: local://Conimgponic
base_branch: work
work_branch: feat/diff-merge-operation-pane-telemetry
priority: P1
langs: [typescript]
status: draft
last_reviewed_at: 2025-10-30
next_review_due: 2025-11-13
```

## Objective

OperationPane からの `queueMergeCommand` が Collector Surface を `diff-merge.operation-pane` に固定し、Analyzer と整合したテレメトリを送出できるようにする。

## Scope

- In: `src/components/diffMergeState.ts`, `tests/merge/diff-merge-view-state.test.ts`
- Out: `MergeDock` 統合、`HunkList` の collector surface、既存 AutoSave テレメトリ

## Requirements

- Behavior:
  - OperationPane の「Queue Selected」アクションが `telemetryContext.collectorSurface` に `diff-merge.operation-pane` を設定した `DiffMergeQueueCommandPayload` を生成すること。
  - `DiffMergeController.queueMerge` は OperationPane 由来の collector surface を維持したままハンクIDフィルタリングと結果ディスパッチを行うこと。
- I/O Contract:
  - Input: `DiffMergeController.queueMerge(hunkIds)`、`OperationPane` から渡されるハンクID集合。
  - Output: `DiffMergeQueueCommandPayload`（`origin: 'operation-pane.queue'`, `telemetryContext.collectorSurface: 'diff-merge.operation-pane'`, `telemetryContext.analyzerSurface: 'diff-merge.queue'`）。
- Constraints:
  - Day8 Guardrails の最小差分/型安全/TDD 指針を遵守し、既存 public API を変更しない。
  - 既存テスト命名・構造を尊重し、不要なコンポーネント分割を行わない。
- Acceptance Criteria:
  - OperationPane 経由のキュー投入を検証する赤テストが `telemetryContext.collectorSurface` を `diff-merge.operation-pane` として検証すること。
  - `pnpm test -- --filter diff-merge-view-state` がグリーン。

## Affected Paths

- src/components/diffMergeState.ts
- tests/merge/diff-merge-view-state.test.ts

## Local Commands

```bash
pnpm test -- --filter diff-merge-view-state
```

## Deliverables

- PR: DiffMerge OperationPane テレメトリ collector surface 修正の概要、Intent: INT-001、リスク評価、テストログ。
- Artifacts: 更新されたテストケース、`pnpm test -- --filter diff-merge-view-state` の実行記録。

---

## Plan

1. OperationPane からの `queueMergeCommand` が `telemetryContext.collectorSurface === 'diff-merge.operation-pane'` となるテストを追加する。
2. `toQueuePayload` が OperationPane collector surface を返すよう最小差分で更新し、必要に応じて型整合を取る。
3. `pnpm test -- --filter diff-merge-view-state` を実行してテレメトリ修正を検証し、結果を Tests/Commands セクションへ記録する。

## Patch

- `tests/merge/diff-merge-view-state.test.ts` に OperationPane queue の collector surface を検証するケースを追加。
- `src/components/diffMergeState.ts` の `toQueuePayload` を OperationPane collector surface 固定と型整合に合わせて更新。

## Tests

- `pnpm test -- --filter diff-merge-view-state`（`tests/components/DiffMergeView.test.tsx` が `[Object: null prototype]` 例外で失敗。環境依存の ts-node/esm 実行エラーを別途切り分ける必要あり）。

## Commands

- `pnpm test -- --filter diff-merge-view-state`

## Notes

### Rationale

- Day8 HUB/TASKS のガイドに従い、Collector/Analyzer surface の整合を保証することでテレメトリ可観測性を維持する。

### Risks

- OperationPane 以外の collector surface へ影響させないようにするため、型境界の更新漏れがあると Regression を招く可能性。

### Follow-ups

- MergeDock から OperationPane を経由したテレメトリ共通化の必要性を別タスクで評価する。
- `tests/components/DiffMergeView.test.tsx` が ts-node/esm 実行時に `[Object: null prototype]` 例外で落ちる事象を QA へエスカレーションし、テストハーネス側の設定を確認する。
