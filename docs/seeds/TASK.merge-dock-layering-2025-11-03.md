# Task Seed

## メタデータ

```yaml
task_id: 20251103-01
repo: local://Conimgponic
base_branch: work
work_branch: feat/merge-dock-layering
priority: P2
langs: [typescript]
status: draft
last_reviewed_at: 2025-11-03
next_review_due: 2025-11-17
```

## Objective

Day8/workflow-cookbook/GUARDRAILS.md「変更は最小差分で行い、Public API を破壊しない。」と Day8/docs/day8/guides/07_contributing.md「1タスク=1ブランチ=1PR」へ従い、`src/components/MergeDock.tsx` の 592 行規模ロジックを「ストア構築」「差分マージ用ドメイン関数」「React UI」の三層に分離する。

## Scope

- In: `src/components/MergeDock.tsx`, `src/components/merge-dock/store.ts`, `src/components/merge-dock/model.ts`, `tests/components/merge.diff.test.tsx`, `tests/merge/merge-dock-tabs.test.ts`
- Out: `src/lib/merge/**` の挙動変更、`DiffMergeView` UI 拡張

## Requirements

- Behavior:
  - 既存タブ制御・通知・OPFS スナップショット操作がリファクタリング後も同一であること。
  - Day8/workflow-cookbook/GUARDRAILS.md が求める「実装時はテスト駆動開発を基本とし、テストを先に記述する。」を満たすよう、RED→GREEN の検証ログを残す。
- I/O Contract:
  - Store 層: `createMergeDockViewStore(initialTab, preference)` が `zustand` の `StoreApi` を返す。
  - Domain 層: `mergeMarkdownStoryboard(current, markdown, mode)` が Storyboard を返し、`MergeDock` 側から再エクスポートされる。
  - UI 層: `MergeDock` はストア/ドメイン関数を import し描画のみを担う。
- Constraints:
  - Day8/docs/day8/guides/07_contributing.md の「変更は小さく・短時間で終わるブランチとして切り、早めの rebase で常に最新に追従する。」に従い、差分は 3 ファイル以内・型注釈は既存定義を再利用。
  - Guardrails の「インポート順序：標準ライブラリ→外部依存→内部モジュール」を保持。
- Acceptance Criteria:
  - `pnpm test -- tests/components/merge.diff.test.tsx` と `pnpm test -- tests/merge/merge-dock-tabs.test.ts` が GREEN で完走し、RED ログを Task Seed に添付済みであること。
  - `mergeMarkdownStoryboard` を `MergeDock` から利用する既存テストが成功すること。

## Affected Paths

- src/components/MergeDock.tsx
- src/components/merge-dock/store.ts
- src/components/merge-dock/model.ts
- tests/components/merge.diff.test.tsx
- tests/merge/merge-dock-tabs.test.ts

## Local Commands（存在するものだけ実行）

```bash
pnpm test -- tests/components/merge.diff.test.tsx
pnpm test -- tests/merge/merge-dock-tabs.test.ts
```

## Deliverables

- PR: MergeDock 三層分離の概要、Intent: INT-001、リスク評価、検証ログ
- Artifacts: ストア/モデル分離後の TypeScript ファイル、テストログ（RED/GREEN）

---

## Plan

### Steps

1) Day8/workflow-cookbook/HUB.codex.md のタスク分割フローに従い、既存ロジックをストア・モデル・UI 単位に棚卸しして責務を明確化する。
2) `src/components/merge-dock/store.ts` に `createMergeDockViewStore` と `useMergeDockViewStore` を実装し、UI から Zustand 実装を隠蔽する。
3) `src/components/merge-dock/model.ts` に差分マージ用ドメイン関数 (`mergeMarkdownStoryboard`, `computeStoryboardWarnings`, `readAutoSaveState` など) を移し、`MergeDock` 経由で再エクスポートする。
4) `MergeDock.tsx` を UI 専任とし、Day8/docs/day8/guides/07_contributing.md の衝突回避方針に沿ってテスト（RED→GREEN）で裏付ける。

## Patch

_未着手_

## Tests

### RED

- 2025-11-03: `pnpm test -- tests/components/merge.diff.test.tsx` → 失敗 (ヘルパー未再エクスポート) 【373343†L1-L58】
- 2025-11-03: `pnpm test -- tests/merge/merge-dock-tabs.test.ts` → 失敗 (UI 層未分離) 【136d0d†L1-L138】

### GREEN

- 2025-11-03: `pnpm test -- tests/components/merge.diff.test.tsx` → 成功 【bc0fdd†L1-L55】
- 2025-11-03: `pnpm test -- tests/merge/merge-dock-tabs.test.ts` → 成功 【9ab45b†L1-L28】

## Commands

### Run gates

- `pnpm test -- tests/components/merge.diff.test.tsx`（RED→GREEN ログ: 【373343†L1-L58】【bc0fdd†L1-L55】）
- `pnpm test -- tests/merge/merge-dock-tabs.test.ts`（RED→GREEN ログ: 【136d0d†L1-L138】【9ab45b†L1-L28】）

## Notes

- Day8/workflow-cookbook/HUB.codex.md の「ノード抽出→粒度調整」を踏まえ、タブ計画ロジックの責務を `model.ts` に寄せて UI を軽量化する。
- Guardrails の「副作用の隔離」を満たすため、OPFS/API 呼び出しはドメイン層から越境しないことを確認する。
