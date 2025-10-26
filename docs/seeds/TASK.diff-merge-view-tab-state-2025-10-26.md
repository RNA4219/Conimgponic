# Task Seed

## メタデータ

```yaml
task_id: 20251026-01
repo: local://Conimgponic
base_branch: work
work_branch: feat/diff-merge-view-tab-state
priority: P1
langs: [typescript]
status: draft
last_reviewed_at: 2025-10-26
next_review_due: 2025-11-09
```

## Objective

DiffMergeView のタブ初期化を precision 別に localStorage へ永続化し、`resolveDiffMergeStoredTab` を利用した許容タブ復元と切替時更新を保証する。

## Scope

- In: `src/components/DiffMergeView.tsx`, `tests/components/DiffMergeView.test.tsx`
- Out: `diffMergeState.ts`、`MergeDock` のタブ構成、API コントラクト

## Requirements

- Behavior:
  - `resolveDiffMergeStoredTab` は precision ごとの許容タブか検証し、無効な保存値を破棄して初期タブを決定すること。
  - `DiffMergeView` は初期表示時に storage からタブ状態を復元し、タブ切替時に許容タブのみを storage へ保存すること。
  - 選択中タブは `queueMergeCommand` の `telemetryContext.lastTab` に必ず反映されること（Day8 Guardrails の型安全/TDD/最小差分ガイド遵守）。
- I/O Contract:
  - Input: `precision`, `hunks`, `queueMergeCommand`
  - Storage: `localStorage['diff-merge.lastTab.<precision>']`
  - Output: JSX（`data-testid` は既存値を保持）
- Constraints:
  - precision ごとの許容タブ定義を既存 `planDiffMergeView` から取得し、副作用は storage 操作に限定する。
  - 既存 reducer と controller 呼び出し位置を変えない。
- Acceptance Criteria:
  - 無効タブの保存値がある場合でも許容タブにフォールバックし、storage から削除される。
  - `pnpm test -- --filter diff-merge-view-state` がグリーン。

## Affected Paths

- src/components/DiffMergeView.tsx
- tests/components/DiffMergeView.test.tsx

## Local Commands

```bash
pnpm test tests/components/DiffMergeView.test.tsx
pnpm test -- --filter diff-merge-view-state
```

## Deliverables

- PR: DiffMergeView タブ永続化の精度ガード実装概要、Intent: INT-001、リスク評価、テスト結果
- Artifacts: 更新されたタブ永続化ロジックとテストログ

---

## Plan

1. `tests/merge/diff-merge-view-state.test.ts` へ選択タブが `queueMergeCommand` の `telemetryContext.lastTab` に伝播することを検証するテストを追加し、TDD 先行で Day8 HUB/TASKS 方針どおり Task Seed を更新する。
2. `DiffMergeView` で precision 別許容タブ集合を生成し、初期復元・タブ切替時に localStorage を更新するロジックを実装する。
3. `DiffMergeView` が `createDiffMergeController` へ `resolveCurrentTab` を渡す最小差分の修正を加え、テストを緑化する。
4. `pnpm test tests/components/DiffMergeView.test.tsx` と `pnpm test -- --filter diff-merge-view-state` を実行し、storage 永続化とテレメトリ伝播のリグレッションが解消されたことを確認する。

## Patch

_未着手_

## Tests

_未実施_

## Commands

_未実行_

## Notes

### Rationale

- precision ごとに露出タブが異なるため、storage 復元時に不正タブが選択されるリスクを排除する。

### Risks

- SSR 環境で `localStorage` が未定義の場合、ガード条件の抜け漏れがあると例外が発生する可能性。

### Follow-ups

- `resolveDiffMergeStoredTab` の検証ケースを `tests/merge/` 階層へ集約するか検討。
