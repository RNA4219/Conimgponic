# Task Seed

## メタデータ

```yaml
task_id: 20251027-02
repo: local://Conimgponic
base_branch: work
work_branch: feat/diff-merge-autosave-meets-target
priority: P1
langs: [typescript]
status: draft
last_reviewed_at: 2025-10-27
next_review_due: 2025-11-10
```

## Objective

DiffMergeView コントローラの queue payload が autoApplied.meetsTarget の値を忠実に反映するようにし、autoSaveRequested が誤って true にならないよう保証する。

## Scope

- In: `tests/merge/diff-merge-view-state.test.ts`, `src/components/diffMergeState.ts`, `src/components/DiffMergeView.tsx`
- Out: MergeDock 以外の UI、バックエンド API コントラクト、他テストスイート

## Requirements

- Behavior:
  - autoApplied.meetsTarget が `false` の場合、`queueMergeCommand` に渡される `metadata.autoSaveRequested` は必ず `false` になること。
  - autoApplied.meetsTarget が `true` または `null` の場合は従来の精度別挙動（legacy を除き `true`）を維持すること。
  - `DiffMergeView` は `autoApplied` 状態を受け取り、`createDiffMergeController` へ伝播すること。
- I/O Contract:
  - Input: `autoApplied` は `{ rate: number | null, target: number, meetsTarget: boolean | null }`。
  - Output: `DiffMergeQueueCommandPayload.metadata.autoSaveRequested`。
- Constraints:
  - Day8 Guardrails（型安全/TDD/最小差分）を守り、テストを先に追加する。
  - 既存 Public API（`DiffMergeQueueCommandPayload` など）の互換性を保つ。
- Acceptance Criteria:
  - `pnpm test -- --filter diff-merge-view-state` がグリーン。
  - autoApplied.meetsTarget=false のテストが失敗から成功へ転じる。

## Affected Paths

- src/components/diffMergeState.ts
- src/components/DiffMergeView.tsx
- tests/merge/diff-merge-view-state.test.ts

## Local Commands

```bash
pnpm test -- --filter diff-merge-view-state
```

## Deliverables

- PR: autoSaveRequested と autoApplied の整合性修正（Intent: INT-001）
- Artifacts: テストログ

---

## Plan

1. `tests/merge/diff-merge-view-state.test.ts` に autoApplied.meetsTarget=false を想定した失敗テストを追加し、TDD で再現する。
2. `src/components/diffMergeState.ts` へ autoApplied 状態を受け取るインターフェースを追加し、`metadata.autoSaveRequested` の判定を meetsTarget に基づくよう改修する。
3. `DiffMergeView.tsx` が autoApplied を受け取り controller へ渡すよう最小差分でリファクタし、関連依存を更新する。
4. `pnpm test -- --filter diff-merge-view-state` を実行し、修正がグリーンになることを確認する。

## Patch

_未着手_

## Tests

_未実施_

## Commands

_未実行_

## Notes

### Rationale

- Diff タブの自動保存は autoApplied のターゲット達成状況に従う必要があり、Day8 Guardrails の後方互換と最小差分指針に基づき実装する。

### Risks

- autoApplied が未提供の場合のフォールバック処理が抜けると既存挙動に影響する可能性。

### Follow-ups

- MergeDock からの autoApplied 供給有無を監視し、別タスクで連携を検討。
