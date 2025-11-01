# Task Seed

## メタデータ

```yaml
task_id: 20251101-02
repo: local://Conimgponic
base_branch: main
work_branch: fix/app-toolbar-import-regression
priority: P0
langs: [typescript]
status: proposed
last_reviewed_at: 2025-11-01
next_review_due: 2025-11-08
```

## Objective

`src/App.tsx` でツールバーの「Load Project」「Package Export」ボタンが未定義ハンドラを参照しているため、UI 操作時に ReferenceError を発生させず、`src/toolbar/handlers.ts` に移設済みの公式 API を利用するよう修正する。

## 背景と根拠

- `Day8/workflow-cookbook/HUB.codex.md` および `Day8/docs/TASKS.md` で示される「副作用ロジックの専用モジュール集約」および「単一責務」の方針に違反している。
- ツールバー実装の正式な I/F は `src/toolbar/handlers.ts` に整理済みであり、App 直下からの呼び出しが必要。

## Scope

- In: `src/App.tsx`, `src/toolbar/handlers.ts`, `tests/app/AppToolbar.spec.tsx`
- Out: MergeDock, autosave、テンプレート機能一式

## Requirements

- `App.tsx` のツールバーコンポーネントが `handleToolbarLoadProject` / `handleToolbarPackageExport` を `src/toolbar/handlers` から import して利用すること。
- 二重定義を追加せず、既存の `ToolbarNotifiers` や共通エラーハンドラを再利用すること。
- `tests/app/AppToolbar.spec.tsx` を node:test で RED→GREEN 検証し、結果ログを「Tests」節に残すこと。

## Affected Paths

- src/App.tsx
- src/toolbar/handlers.ts
- tests/app/AppToolbar.spec.tsx

## Tests

- `pnpm test -- tests/app/AppToolbar.spec.tsx`
- 2025-11-01: GREEN (`pnpm test -- tests/app/AppToolbar.spec.tsx`)

## Notes

- HUB/GUARDRAILS 参照済み。UI の Public API を変更しない。
