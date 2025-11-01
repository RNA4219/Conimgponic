# Task Seed

## メタデータ

```yaml
task_id: 20250216-01
repo: local://Conimgponic
base_branch: work
work_branch: fix/merge-dock-store-dedup
priority: P1
langs: [typescript]
status: draft
last_reviewed_at: 2025-02-16
next_review_due: 2025-03-02
```

## Objective

Day8/workflow-cookbook/GUARDRAILS.md の「変更は最小差分で行い、Public API を破壊しない」「実装時はテスト駆動開発を基本とし、テストを先に記述する」指針と、Day8/docs/day8/guides/07_contributing.md の「1タスク=1ブランチ=1PR」「タスクは独立性が保てる粒度で分割する」を引用し、src/components/MergeDock.tsx で再宣言されている MergeDockViewStore／createMergeDockViewStore と StoreApi／createStore の直接利用を撤廃し、src/components/merge-dock/store.ts のエクスポートへ統一する修正方針と検証計画を整理する。

## Scope

- In: `src/components/MergeDock.tsx`, `src/components/merge-dock/store.ts`, `src/lib/locks.ts`, `tests/merge/merge-dock-tabs.test.ts`, `docs/seeds/TASK.merge-dock-store-dedup-2025-02-16.md`
- Out: merge-dock 以外の UI レイヤ

## Requirements

- Behavior:
  - MergeDock.tsx は `merge-dock/store.ts` に集約された Zustand ストア API を再利用し、タブ状態やユーザー設定の保持を維持する。
  - 重複定義を除去しても差分マージ関連のガード（バックアップ CTA・autosave ハートビートなど）が既存どおりに機能する。
- Constraints:
  - Guardrails のインポート順・型安全方針を守り、StoreApi／createStore の直接利用を廃止する差分のみとする。
  - Contributing ガイドが示す 3 ファイル以内・最小差分の目安を踏まえ、MergeDock.tsx の再宣言を削除する修正に限定する。
- Acceptance Criteria:
  - `pnpm test -- tests/merge/merge-dock-tabs.test.ts` を GREEN で完走させ、Store API の再利用後も UI が崩れないことを確認する。
  - TypeScript の重複識別子エラーが解消され、`pnpm typecheck` が GREEN で完走する。

## Affected Paths

- src/components/MergeDock.tsx
- src/components/merge-dock/store.ts
- src/lib/locks.ts
- tests/merge/merge-dock-tabs.test.ts
- docs/seeds/TASK.merge-dock-store-dedup-2025-02-16.md

## Local Commands（存在するものだけ実行）

```bash
pnpm typecheck
pnpm test -- tests/merge/merge-dock-tabs.test.ts
```

## Deliverables

- PR: MergeDock.tsx のストア再宣言削除とテストログ
- Artifacts: TypeScript 重複解消後の GREEN ログ、RED ログとしての重複識別子エラーメモ

---

## Plan

1) Day8/workflow-cookbook/HUB.codex.md のタスク分割フローに従って、MergeDock.tsx に残る Store 再定義箇所と依存ファイルを棚卸しする。
2) Day8/docs/TASKS.md のテンプレート順に Objective/Scope/Requirements を整え、`pnpm typecheck` で重複識別子エラーを RED として記録しつつ、`pnpm test -- tests/merge/merge-dock-tabs.test.ts` のベースラインを取得する。
3) MergeDock.tsx を `merge-dock/store.ts` エクスポートへ統一し、再度 `pnpm typecheck` と `pnpm test -- tests/merge/merge-dock-tabs.test.ts` を実行して GREEN を確認、検証ログを Seed に反映する。

## Patch

- 2025-02-16: MergeDock.tsx から MergeDockViewStore／createMergeDockViewStore の再宣言を除去し、import に統一する差分案

## Tests

### RED

- 2025-02-16 10:25: `pnpm typecheck`
  - ❌ `src/components/MergeDock.tsx:19:3 - error TS2440: Import declaration conflicts with local declaration of 'computeStoryboardWarnings'.`【37133b†L1-L27】

### GREEN

- 2025-02-16 10:33: `pnpm test -- tests/merge/merge-dock-tabs.test.ts`
  - ✅ 27 tests passed（diff backup CTA / autosave ハートビート検証含む）【16f16f†L1-L44】

## Commands

- `pnpm typecheck`
- `pnpm test -- tests/merge/merge-dock-tabs.test.ts`

## Notes

- Guardrails が求める最小差分を維持するため、Store API の再定義除去に絞った差分で完了させる。TypeScript duplicate 対応以外のリファクタは後続タスクへ分離する。
