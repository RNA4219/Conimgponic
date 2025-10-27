# Task Seed

## メタデータ

```yaml
task_id: 20251028-03
repo: local://Conimgponic
base_branch: work
work_branch: feat/merge-dock-autosave-guard
priority: P1
langs: [typescript]
status: draft
last_reviewed_at: 2025-10-28
next_review_due: 2025-11-11
```

## Objective

MergeDock から DiffMergeView へ autoApplied.meetsTarget を伝搬させ、Day8 Guardrails の自動保存条件を満たす queue payload テレメトリを保証する。

## Scope

- In: `src/components/MergeDock.tsx`, `src/components/diffMergeState.ts`, `src/components/DiffMergeView.tsx`, `tests/merge/diff-merge-view-state.test.ts`
- Out: GoldenCompare や他タブ UI、バックエンド API 実装全般

## Requirements

- Behavior:
  - Day8/workflow-cookbook/HUB.codex.md のタスク分割フローに従い、`autoApplied.meetsTarget=false` の際に `DiffMergeQueueCommandPayload.metadata.autoSaveRequested` が `false` になることを検証するテストを追加する。
  - MergeDock は Phase Plan の `autoApplied` 情報を DiffMergeView に引き渡し、controller を経由して queue payload へ到達させる。
  - 既存の `autoApplied.meetsTarget=true/null` の挙動（legacy 以外は `true`）を維持する。
- I/O Contract:
  - Input: `autoApplied` は `{ rate: number | null, target: number, meetsTarget: boolean | null }`。
  - Output: `DiffMergeQueueCommandPayload.metadata.autoSaveRequested`。
- Constraints:
  - Day8/workflow-cookbook/GUARDRAILS.md の型安全・最小差分・TDD 原則を順守する。
  - Day8/docs/TASKS.md のテンプレ順にメタデータと検証ログを更新し、1タスク=1PR 運用（Day8/docs/day8/guides/07_contributing.md）を守る。
- Acceptance Criteria:
  - `pnpm test -- --filter diff-merge-view-state` がグリーンで完了する。
  - 新規テストが `autoApplied.meetsTarget=false` を再現し、修正前は失敗・修正後は成功する。

## Affected Paths

- src/components/MergeDock.tsx
- src/components/diffMergeState.ts
- src/components/DiffMergeView.tsx
- tests/merge/diff-merge-view-state.test.ts

## Local Commands

```bash
pnpm test -- --filter diff-merge-view-state
```

## Deliverables

- PR: autoSaveRequested 判定の修正（Intent: INT-001, Priority: P1）
- Artifacts: テストログ、Task Seed Notes への検証結果

---

## Plan

1. Day8/docs/TASKS.md のフローに従い、`tests/merge/diff-merge-view-state.test.ts` に `autoApplied.meetsTarget=false` を再現するテストを追加して失敗を確認する。
2. MergeDock (`src/components/MergeDock.tsx`) から DiffMergeView へ `autoApplied` を渡し、`createDiffMergeController` → `toQueuePayload` で metadata を判定できるよう配線する。
3. `src/components/diffMergeState.ts` / `DiffMergeView.tsx` の必要箇所を Day8 Guardrails の最小差分で調整し、型整合性を保つ。
4. `pnpm test -- --filter diff-merge-view-state` を実行し、緑化後に Task Seed の Tests/Notes を更新する。

## Patch

_未着手_

## Tests

_未実施_

## Commands

_未実行_

## Notes

### Rationale

- autoApplied のターゲット未達時に自動保存を抑止する要件は Day8 Guardrails（後方互換・TDD）で明文化されているため、UI 経路でも担保する。

### Risks

- autoApplied が `null` のケースを誤判定すると既存ユーザー体験が変化する恐れ。

### Follow-ups

- MergeDock の diffMergeNoopCommand を実装隊列へ差し替えるフォローアップ検討。
