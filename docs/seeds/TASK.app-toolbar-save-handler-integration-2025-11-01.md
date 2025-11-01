# Task Seed

## メタデータ

```yaml
task_id: 20251101-03
repo: local://Conimgponic
base_branch: main
work_branch: refactor/app-toolbar-save-handler
priority: P1
langs: [typescript]
status: proposed
last_reviewed_at: 2025-11-01
next_review_due: 2025-11-08
```

## Objective

`src/App.tsx` に残存する `handleToolbarSaveProject` と `ToolbarNotifiers` などの保存ロジックを `src/toolbar/handlers.ts` の単一実装へ統合し、将来の変更漏れを防止する。

## 背景と根拠

- `Day8/workflow-cookbook/HUB.codex.md` と `Day8/docs/TASKS.md` が示す「最小差分」「単一責務」の原則に従い、保存ハンドラを UI レイヤーから分離する必要がある。
- `Day8/workflow-cookbook/GUARDRAILS.md` と `Day8/docs/day8/guides/07_contributing.md` では、重複ロジックを排除し、共通モジュールの再利用を求めている。

## Scope

- In: `src/App.tsx`, `src/toolbar/handlers.ts`, `tests/app/AppToolbar.spec.tsx`
- Out: Autosave, MergeDock, CLI 連携

## Requirements

- `src/App.tsx` から保存関連の型・関数定義を削除し、`src/toolbar/handlers` から `ToolbarNotifiers` / `handleToolbarSaveProject` / `notifyOpfsFailure` を import して利用する。
- 追加の副作用を発生させず、既存 API シグネチャを変更しない。
- `tests/app/AppToolbar.spec.tsx` を node:test で RED→GREEN 実行し、結果を本 Task Seed に記録する。

## Tests

- `pnpm test -- tests/app/AppToolbar.spec.tsx`
- 2025-11-01: GREEN (`pnpm test -- tests/app/AppToolbar.spec.tsx`)

## Notes

- 変更差分を 3 ファイル以内に抑え、既存テレメトリ連携へ影響を出さない。
