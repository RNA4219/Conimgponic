# Task Seed

## メタデータ

```yaml
task_id: 20251101-07
repo: local://Conimgponic
base_branch: main
work_branch: chore/app-toolbar-import-unify
priority: P1
langs: [typescript]
status: draft
last_reviewed_at: 2025-11-01
next_review_due: 2025-11-08
```

## Objective

`src/App.tsx` のツールバー周辺でハンドラ import/export が二重化している問題を整理し、`src/toolbar/handlers.ts` の公式 API へ統一して保守性を高める。

## 背景と根拠

- > Day8/workflow-cookbook/GUARDRAILS.md — 「型安全：新規・変更シグネチャには必ず型を付与」「変更は最小差分で行い、Public API を破壊しない。」【F:Day8/workflow-cookbook/GUARDRAILS.md†L33-L52】
- > Day8/docs/day8/guides/07_contributing.md — 「1タスク=1ブランチ=1PR（±300行/≤3ファイルを目安）」に従って粒度を固定する。【F:Day8/docs/day8/guides/07_contributing.md†L4-L11】
- `Day8/workflow-cookbook/HUB.codex.md` / `Day8/docs/TASKS.md` が示す Task Seed 運用に合わせ、整理した影響範囲と検証手順を共有する必要がある。【F:Day8/workflow-cookbook/HUB.codex.md†L1-L122】【F:Day8/docs/TASKS.md†L1-L48】

## Scope

- In: `src/App.tsx`
- Out: `src/toolbar/handlers.ts`, テレメトリ、MergeDock 系 UI

## Requirements

- `src/App.tsx` が `handleToolbarSaveProject` / `handleToolbarLoadProject` / `handleToolbarPackageExport` / `ToolbarNotifiers` を単一 import で取得し、再エクスポートも 1 宣言に統合すること。
- `ToolbarSave` 型導出で `Parameters<typeof handleToolbarSaveProject>` を活用し、型安全を維持すること。
- `pnpm test --filter "AppToolbar"` を RED→GREEN で実行し、ログを Tests 節へ追記すること。

## Affected Paths

- src/App.tsx
- docs/seeds/TASK.app-toolbar-import-unification-2025-11-01.md

## Local Commands

- `pnpm test --filter "AppToolbar"`

## Tests

- RED（事前実行、既存コードのまま）：`pnpm test --filter "AppToolbar"`（既存実装が想定どおり GREEN のため失敗ケースは再現せず）【9d9cb6†L1-L16】
- GREEN：`pnpm test --filter "AppToolbar"`【edb103†L1-L16】

## Notes

- 影響は import/export の整理のみで、UI の Public API を変更しない想定。
- Guardrails / Contributing ガイドを参照済み。差分は 1PR に収まる粒度で完了予定。
