# Task Seed

## メタデータ

```yaml
task_id: 20251101-02
repo: local://Conimgponic
base_branch: work
work_branch: feat/merge-dock-type-dedup
priority: P2
langs: [typescript]
status: draft
last_reviewed_at: 2025-11-01
next_review_due: 2025-11-15
```

## Objective

Day8/workflow-cookbook/GUARDRAILS.md「変更は最小差分で行い、Public API を破壊しない。」と Day8/docs/day8/guides/07_contributing.md「タスクは独立性が保てる粒度まで分割し、責務の重複（コンフリクト）を避ける。」を引用し、`src/components/MergeDock.tsx` に残る MergeDock 型 (`MergeDockAutoSaveState` など) の重複定義を排除して `src/components/merge-dock/model.ts` を唯一の型ソースとする。

## Scope

- In: `src/components/MergeDock.tsx`, `src/components/merge-dock/domain.ts`, `src/components/merge-dock/model.ts`, `tests/components/merge.diff.test.tsx`, `tests/merge/merge-dock-tabs.test.ts`
- Out: `src/lib/merge/**` の挙動変更、`MergeDock` UI の新規機能追加

## Requirements

- Behavior:
  - `src/components/MergeDock.tsx` から `MergeDockAutoSaveState`/`MergeDockWindow`/`MergeDockNotice` などの再定義を削除し、`model.ts` で提供される型をそのまま参照する。
  - `startMergeDockAutoSaveHeartbeat` と `readAutoSaveState` は `model.ts` の型と整合し、UI から利用できる。
- I/O Contract:
  - `src/components/merge-dock/model.ts` が MergeDock UI で必要な型 (`MergeDockAutoSaveState`, `MergeDockNotice`, `MergeDockWindow`, `MergeDockAutoSaveHeartbeatState`, `MergeDockAutoSaveHeartbeatOptions`) をエクスポートする。
  - `src/components/merge-dock/domain.ts` はドメイン関数を提供しつつ `model.ts` の型を再エクスポートする。
- Constraints:
  - Guardrails の型安全要求に従い、`DiffBackupAutoSaveState` への直接依存を UI 層から排除する。
  - 貢献ガイドが求める粒度を守り、差分は 3 ファイル以内・公共 API 無変更とする。
- Acceptance Criteria:
  - `pnpm test -- tests/components/merge.diff.test.tsx` と `pnpm test -- tests/merge/merge-dock-tabs.test.ts` が GREEN で完走し、RED→GREEN のログを Seed に保存する。
  - UI 層での型重複による `Identifier ... has already been declared` エラーが解消されたことを Notes に記録する。

## Affected Paths

- src/components/MergeDock.tsx
- src/components/merge-dock/domain.ts
- src/components/merge-dock/model.ts
- tests/components/merge.diff.test.tsx
- tests/merge/merge-dock-tabs.test.ts

## Local Commands（存在するものだけ実行）

```bash
pnpm test -- tests/components/merge.diff.test.tsx
pnpm test -- tests/merge/merge-dock-tabs.test.ts
```

## Deliverables

- PR: MergeDock 型の重複削除によるモデル層一元化とテストログ
- Artifacts: `model.ts` 型集約差分、RED→GREEN テスト出力

---

## Plan

### Steps

1) Guardrails/HUB.codex.md に従い MergeDock UI の型ソースを棚卸し、`model.ts` の欠落型を洗い出す。
2) `model.ts` へ不足型を追加し、`domain.ts` から再エクスポートする。
3) `MergeDock.tsx` から重複定義を削除し、`model.ts` の型を import してテスト (RED→GREEN) を実行する。

## Patch

_未着手_

## Tests

### RED

- 2025-11-01: `pnpm test -- tests/components/merge.diff.test.tsx` → 失敗 (SyntaxError: Identifier 'startMergeDockAutoSaveHeartbeat' has already been declared) 【948656†L1-L29】
- 2025-11-01: `pnpm test -- tests/merge/merge-dock-tabs.test.ts` → 失敗 (SyntaxError: Identifier 'startMergeDockAutoSaveHeartbeat' has already been declared) 【6b12f8†L1-L28】

### GREEN

- 2025-11-01: `pnpm test -- tests/components/merge.diff.test.tsx` → 成功 【c12a35†L1-L56】
- 2025-11-01: `pnpm test -- tests/merge/merge-dock-tabs.test.ts` → 成功 【061e73†L1-L36】

## Commands

### Run gates

- `pnpm test -- tests/components/merge.diff.test.tsx`（RED→GREEN ログ: 【948656†L1-L29】【c12a35†L1-L56】）
- `pnpm test -- tests/merge/merge-dock-tabs.test.ts`（RED→GREEN ログ: 【6b12f8†L1-L28】【061e73†L1-L36】）

## Notes

- UI 層で重複定義されていた MergeDock 型を削除し、`model.ts` に集約することで SyntaxError: Identifier 'startMergeDockAutoSaveHeartbeat' has already been declared が解消された。
