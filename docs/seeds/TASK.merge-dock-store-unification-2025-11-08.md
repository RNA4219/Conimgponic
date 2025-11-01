# Task Seed

## メタデータ

```yaml
task_id: 20251108-01
repo: local://Conimgponic
base_branch: work
work_branch: feat/merge-dock-store-unification
priority: P2
langs: [typescript]
status: draft
last_reviewed_at: 2025-11-08
next_review_due: 2025-11-22
```

## Objective

Day8/workflow-cookbook/GUARDRAILS.md が求める「変更は最小差分で行い、Public API を破壊しない」「実装時はテスト駆動開発を基本とし、テストを先に記述する」を守り、Day8/docs/day8/guides/07_contributing.md の「1タスク=1ブランチ=1PR」「タスクは独立性が保てる粒度で分割する」に従いつつ、MergeDock UI から直接 `StoreApi` / `createStore` を扱う再定義を廃し、`src/components/merge-dock/store.ts` に一本化された API を用いる検証計画を整理する。

## Scope

- In: `src/components/MergeDock.tsx`, `src/components/merge-dock/store.ts`, `tests/merge/merge-dock-tabs.test.ts`, `tests/components/merge.diff.test.tsx`, `docs/seeds/TASK.merge-dock-store-unification-2025-11-08.md`
- Out: `src/components/merge-dock/domain.ts` の責務追加、OPFS I/O 実装変更

## Requirements

- Behavior:
  - MergeDock UI は `merge-dock/store.ts` が提供する Zustand store をそのまま import して利用し、タブ遷移とユーザー設定の保持を維持する。
  - diff backup CTA や autosave heartbeat の挙動が Guardrails の受入条件を満たす範囲で変化しない。
- Constraints:
  - Guardrails のインポート順・型安全方針を厳守し、再定義を排除する差分は最小限に留める。
  - Contributing ガイドが示す 3 ファイル以内の変更目安を意識し、store API の再利用に限定した編集とする。
- Acceptance Criteria:
  - `pnpm test -- tests/merge/merge-dock-tabs.test.ts` および `pnpm test -- tests/components/merge.diff.test.tsx` が GREEN で完走する。
  - Task Seed に RED→GREEN の検証ログとフォローアップメモを残す。

## Affected Paths

- src/components/MergeDock.tsx
- src/components/merge-dock/store.ts
- tests/merge/merge-dock-tabs.test.ts
- tests/components/merge.diff.test.tsx
- docs/seeds/TASK.merge-dock-store-unification-2025-11-08.md

## Local Commands（存在するものだけ実行）

```bash
pnpm test -- tests/merge/merge-dock-tabs.test.ts
pnpm test -- tests/components/merge.diff.test.tsx
```

## Deliverables

- PR: MergeDock store API の再利用とテストログ
- Artifacts: GREEN になったテスト結果、RED 時点の再現ログ、Seed 更新履歴

---

## Plan

1) Day8/workflow-cookbook/HUB.codex.md のタスク分割フローに沿って、MergeDock.tsx に残る store 再定義箇所とテスト対象の依存を棚卸しする。
2) Day8/docs/TASKS.md のテンプレート順に、Objective/Scope/Requirements/Commands を整理しつつ、RED ログを取得するために既存テストを実行する。
3) `src/components/MergeDock.tsx` を `merge-dock/store.ts` API の import へ切り替え、再度テストを実行して GREEN を確認し、検証ログを Seed に反映する。

## Patch

- [2025-11-08] store API 再利用の差分案メモ

## Tests

### RED

- 2025-11-08 10:21:07 — `pnpm test -- tests/merge/merge-dock-tabs.test.ts`
  - ❌ `SyntaxError: Identifier 'startMergeDockAutoSaveHeartbeat' has already been declared`【5655eb†L1-L24】
- 2025-11-08 10:24:33 — `pnpm test -- tests/components/merge.diff.test.tsx`
  - ❌ `SyntaxError: Identifier 'startMergeDockAutoSaveHeartbeat' has already been declared`【1fb449†L1-L22】

### GREEN

- 2025-11-08 10:42:11 — `pnpm test -- tests/merge/merge-dock-tabs.test.ts`
  - ✅ 27 tests passed（diff backup CTA / autosave heartbeat 含む）【931cdc†L1-L33】
- 2025-11-08 10:47:56 — `pnpm test -- tests/components/merge.diff.test.tsx`
  - ✅ 57 tests passed（phase plan / preference guard 含む）【894fbd†L1-L55】

## Commands

- `pnpm test -- tests/merge/merge-dock-tabs.test.ts`
- `pnpm test -- tests/components/merge.diff.test.tsx`

## Notes

- Guardrails の「最小読込」手順を満たすため、Birdseye 更新が必要になった場合は別タスクで扱う。
