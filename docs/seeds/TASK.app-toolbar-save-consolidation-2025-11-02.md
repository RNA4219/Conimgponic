# Task Seed

## メタデータ

```yaml
task_id: 20251102-01
repo: local://Conimgponic
base_branch: main
work_branch: refactor/app-toolbar-save-consolidation
priority: P1
langs: [typescript]
status: proposed
last_reviewed_at: 2025-11-02
next_review_due: 2025-11-09
```

## Objective

`src/App.tsx` に残っているツールバー保存系の独自処理を `src/toolbar/handlers.ts` に集約し、単一責務を維持したまま UI からハンドラを再利用できるようにする。

## 背景と影響分析

- `Day8/workflow-cookbook/HUB.codex.md` と `Day8/docs/TASKS.md` は Task Seed に背景/手順/検証ログを整理することと、Guardrails に沿った最小差分・単一責務を要求している。
- `Day8/workflow-cookbook/GUARDRAILS.md` と `Day8/docs/day8/guides/07_contributing.md` は重複ロジックの排除と共通モジュール再利用を必須とし、保存ハンドラを UI から分離する必要がある。
- `src/App.tsx` と `src/toolbar/handlers.ts` の両方に保存処理が存在すると、将来の修正が二重になり整合性が崩れる恐れがあるため、UI ではハンドラモジュールへ委譲し、型は共通定義を用いる。

## Scope

- In: `src/App.tsx`, `tests/app/AppToolbar.spec.tsx`, `docs/seeds/TASK.app-toolbar-save-consolidation-2025-11-02.md`
- Out: Autosave / MergeDock / CLI I/O / Telemetry 実装

## Requirements

- `src/App.tsx` から保存系のロジック重複を削除し、`ToolbarSaveProjectRequest` 由来の型とハンドラを import して再利用する。
- Save ボタンのハンドラはハンドラー側に Storyboard と Save 関数を委譲し、旧オプション（`getStoryboard` / `saveJSONImpl`）との後方互換も維持する。
- 変更差分は 3 ファイル以内・型安全を確保し、Guardrails に記載されたインポート順序・副作用分離を守る。

## Local Commands

- `pnpm test --filter "AppToolbar"`（フィルタ定義未登録のため失敗、別コマンドで代替）
- `pnpm test -- tests/app/AppToolbar.spec.tsx`

## Tests

- RED: `pnpm test -- tests/app/AppToolbar.spec.tsx`（`getStoryboard is not a function` で失敗）【6da3c8†L1-L11】
- GREEN: `pnpm test -- tests/app/AppToolbar.spec.tsx`（全テスト成功）【62cbf0†L1-L8】

## Verification Plan

1. `src/App.tsx` の保存系インターフェースを `ToolbarSaveProjectRequest` ベースの Union に置き換え、UI からの委譲を一本化する。
2. `tests/app/AppToolbar.spec.tsx` に新旧シグネチャの両方を検証するケースを追加し、ハンドラ統合後も型互換が保たれることを確認する。
3. 上記コマンドで RED→GREEN を確認し、差分が型・lint ポリシーに反しないかをレビューする。

## Notes

- `pnpm test --filter "AppToolbar"` は `scripts/test/run-selected.ts` にフィルタキーが未登録のためファイル検索に失敗する（ログ: `Could not find '/workspace/Conimgponic/AppToolbar'`）。追加登録は別タスクとして検討。
