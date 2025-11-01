# Task Seed

## メタデータ

```yaml
task_id: 20251101-06
repo: local://Conimgponic
base_branch: main
work_branch: chore/app-toolbar-reexports
priority: P1
langs: [typescript]
status: proposed
last_reviewed_at: 2025-11-01
next_review_due: 2025-11-08
```

## Objective

`src/App.tsx` の公開 API から `handleToolbarSaveProject` を含むツールバーハンドラ再エクスポートを復元し、OPFS ロード例外の検証を維持する。

## 背景と根拠

> 変更は最小差分で行い、Public API を破壊しない。不可避の場合のみ短い移行メモを添付する。 — Day8/workflow-cookbook/GUARDRAILS.md
>
> タスクは独立性が保てる粒度まで分割し、責務の重複（コンフリクト）を避ける。 — Day8/docs/day8/guides/07_contributing.md

`Day8/workflow-cookbook/HUB.codex.md` と `Day8/docs/TASKS.md` が定義する Task Seed 運用方針に従い、再エクスポート破綻の影響を把握して TDD で修復する。

## Impact Analysis

- `tests/lib/opfs.load-errors.test.ts` は `handleToolbarLoadProject` を `src/App.tsx` 経由で参照しており、再エクスポートが欠落すると OPFS 例外伝播テストが失敗する。
- `scripts/test/run-selected.ts` に対象フィルタを追加しないと `pnpm test --filter "opfs load error propagation"` がパスを解決できず、タスク要件どおりに検証できない。

## Scope

- In: `src/App.tsx`, `scripts/test/run-selected.ts`, `tests/lib/opfs.load-errors.test.ts`, `docs/seeds/TASK.reexport-restore-2025-11-01.md`
- Out: Merge Dock、Autosave 機能、CLI 連携

## Requirements

- `src/App.tsx` で `export { ... } from './toolbar/handlers'` を使い、`handleToolbarSaveProject`/`handleToolbarLoadProject`/`handleToolbarPackageExport` をまとめて再公開する。
- `scripts/test/run-selected.ts` に "opfs load error propagation" フィルタを登録し、指定コマンドで対象テストだけが実行されるようにする。
- `tests/lib/opfs.load-errors.test.ts` からは App の再エクスポート経由でハンドラを参照し続ける（既存 API 互換維持）。
- `pnpm test --filter "opfs load error propagation"` を RED→GREEN で実行し、結果ログを本 Task Seed に記録する。

## Plan

1. `pnpm test --filter "opfs load error propagation"` を実行し、現状の失敗ログ（RED）を取得する。
2. テストランナーへフィルタを追加し、`src/App.tsx` からツールバーハンドラを `export { ... } from './toolbar/handlers'` で再公開する。
3. 再度 `pnpm test --filter "opfs load error propagation"` を実行して GREEN を確認する。
4. Task Seed の Tests セクションに RED/GREEN 両方のログを添付し、フォローアップが不要であることを Notes に記す。

## Tests

- RED: `pnpm test --filter "opfs load error propagation"` （`opfs load error propagation` を解決できず失敗）【b70f52†L1-L3】
- GREEN: `pnpm test --filter "opfs load error propagation"` （OPFS 例外伝播テスト 4 件が成功）【bf929e†L1-L13】

## Notes

- Guardrails と Contributing ガイドの要請どおり、公開 API を変更せずにエラー検証ルートを復元済み。
