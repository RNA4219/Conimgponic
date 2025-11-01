# Task Seed

## メタデータ

```yaml
task_id: 20251104-01
repo: local://Conimgponic
base_branch: work
work_branch: feat/autosave-shortcut-toolbar
priority: P1
langs: [typescript, react]
status: draft
last_reviewed_at: 2025-11-04
next_review_due: 2025-11-18
```

## Objective

AutoSave 統合ロジックとツールバー I/O・キーボードショートカットの副作用を `src/hooks/` / `src/toolbar/` へ分離し、Day8 Guardrails に沿って App.tsx のレンダリング責務を軽量化する。参照: [Day8/workflow-cookbook/GUARDRAILS.md](../../workflow-cookbook/GUARDRAILS.md), [Day8/docs/day8/guides/07_contributing.md](../day8/guides/07_contributing.md)

## Scope

- In: `src/hooks/useAutoSaveIntegration.ts`, `src/App.tsx`, `src/toolbar/handlers.ts`, `tests/app/AppToolbar.spec.tsx`, `tests/hooks/useAutoSaveAppEffects.spec.tsx`
- Out: Autosave ランナー本体 (`src/lib/autosave.ts`)、MergeDock UI の見た目変更

## Requirements

- Behavior:
  - `useAutoSaveAppEffects` が AutoSave guard 通知とキーボードショートカット登録を一元管理し、App.tsx は結果を受け取るだけにする。
  - ツールバーの保存/読込/エクスポート I/O は `createToolbarActions` を通じて実行し、App.tsx のハンドラは委譲する。
  - 既存の `handleSaveProjectButtonClick`・ショートカットハンドラ API は後方互換を維持する。
- I/O Contract:
  - `createToolbarActions` は Zustand ストア互換の `getStoryboard`/`applyStoryboard` を受け取り、OPFS I/O をデフォルト注入する。
  - `useAutoSaveAppEffects` は `store: AutoSaveStoryboardStore` を受け取り、`shortcut.register` のクリーンアップを返却する。
- Constraints:
  - Day8 Guardrails の副作用隔離・TDD 原則に従い、RED→GREEN の順でテストを更新する。
  - 例外発生時は Guardrails の再試行ポリシーに従い、ブラウザ通知とログを保持する。
- Acceptance Criteria:
  - `pnpm test -- --filter AppToolbar` が GREEN。
  - `pnpm test tests/hooks/useAutoSaveAppEffects.spec.tsx` が GREEN。
  - App.tsx の AutoSave/ショートカット副作用が hook へ移動していることをコードレビューで確認できる。

## Affected Paths

- src/hooks/useAutoSaveIntegration.ts
- src/App.tsx
- src/toolbar/handlers.ts
- tests/app/AppToolbar.spec.tsx
- tests/hooks/useAutoSaveAppEffects.spec.tsx

## Local Commands

```bash
pnpm test -- --filter AppToolbar
pnpm test tests/hooks/useAutoSaveAppEffects.spec.tsx
```

## Deliverables

- PR: AutoSave 副作用とツールバー I/O の分離 (Intent: INT-001, Priority: P1)
- Artifacts: RED/GREEN テストログ、キーボードショートカット登録の検証メモ、Guard 通知が発火したログ

---

## Plan

1. `tests/hooks/useAutoSaveAppEffects.spec.tsx` を追加し、ショートカット登録・guard 通知を RED で再現する。
2. `src/toolbar/handlers.ts` に `createToolbarActions` とブラウザ向け notifiers を実装し、OPFS I/O を集約する。
3. `src/hooks/useAutoSaveIntegration.ts` に `useAutoSaveAppEffects` を実装し、AutoSave guard・ショートカット副作用を hook へ移す。
4. `src/App.tsx` をフック利用・ツールバー委譲へリファクタリングし、既存エクスポートの互換性を維持する。
5. `pnpm test -- --filter AppToolbar` と `pnpm test tests/hooks/useAutoSaveAppEffects.spec.tsx` を GREEN で記録し、Notes/Tests/Commands を更新する。

## Patch

- AutoSave 副作用を `useAutoSaveAppEffects` に統合し、App.tsx からキーボードショートカット設定と guard 通知を削除した。
- `createToolbarActions` を追加し、ツールバーの保存/読込/エクスポート I/O を UI から分離した。
- App.tsx のツールバーを `toolbarActions` 呼び出しへ変更し、最小責務に整理した。
- `tests/app/AppToolbar.spec.tsx` を更新し、委譲後のハンドラが `toolbarActions` を参照することを検証した。
- 新規フックテストでショートカット登録と guard 通知の RED→GREEN を確認した。

## Tests

- RED: `pnpm test -- --filter AppToolbar`（hook 実装前に失敗）
- RED: `pnpm test tests/hooks/useAutoSaveAppEffects.spec.tsx`（hook 実装前に失敗）
- GREEN: `pnpm test -- --filter AppToolbar`
- GREEN: `pnpm test tests/hooks/useAutoSaveAppEffects.spec.tsx`

## Commands

- `pnpm test -- --filter AppToolbar`
- `pnpm test tests/hooks/useAutoSaveAppEffects.spec.tsx`

## Notes

### Rationale

- Day8 Guardrails の副作用分離原則に従い、App.tsx を描画責務へ集中させた。
- Contributing ガイドのタスク分割方針に基づき、フック・ツールバー・テストを個別モジュールへ整理した。

### Follow-ups

- AutoSave guard 通知の Telemetry collector 連携を E2E テストで補強する追加タスクを検討する。
