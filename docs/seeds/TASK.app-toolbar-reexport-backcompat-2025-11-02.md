# Task Seed

## メタデータ

```yaml
task_id: 20251102-07
repo: local://Conimgponic
base_branch: main
work_branch: chore/app-toolbar-reexport-backcompat
priority: P1
langs: [typescript]
status: proposed
last_reviewed_at: 2025-11-02
next_review_due: 2025-11-09
```

## Objective

`src/App.tsx` のツールバーハンドラ再エクスポートを整理し、App 公開 API 経由の後方互換を確認する。

## 背景と根拠

> 変更は最小差分で行い、Public API を破壊しない。 — Day8/workflow-cookbook/GUARDRAILS.md
>
> タスクは独立性が保てる粒度まで分割し、責務の重複（コンフリクト）を避ける。 — Day8/docs/day8/guides/07_contributing.md

`Day8/workflow-cookbook/HUB.codex.md` と `Day8/docs/TASKS.md` の Task Seed 運用指針に従い、App からのハンドラ再エクスポート契約を TDD で保護する。

## Scope

- In: `src/App.tsx`, `tests/app/AppToolbar.spec.tsx`, `tests/lib/opfs.load-errors.test.ts`, `docs/seeds/TASK.app-toolbar-reexport-backcompat-2025-11-02.md`
- Out: 自動保存フロー、CLI/JSON 出力、テンプレート同期ロジック以外の UI

## Requirements

- `src/App.tsx` で `handleToolbarSaveProject`/`handleToolbarLoadProject`/`handleToolbarPackageExport` を `export { ... } from './toolbar/handlers'` に統合し、再エクスポート契約を保守する。
- `tests/app/AppToolbar.spec.tsx` は App 経由の import を採用し、Toolbar 操作の回帰を検知できるようにする。
- `tests/lib/opfs.load-errors.test.ts` は App 経由のロードハンドラ参照を維持し、OPFS 非対応時の挙動が変わらないことを検証する。
- 後方互換確認として `pnpm test -- tests/app/AppToolbar.spec.tsx` と `pnpm test -- tests/lib/opfs.load-errors.test.ts` を RED→GREEN で記録する。

## Plan

1. `tests/app/AppToolbar.spec.tsx` の import を App 再エクスポートに切り替え、RED を取得する。
2. `src/App.tsx` の再エクスポートを整理し、すべての Toolbar ハンドラを集約する。
3. `tests/lib/opfs.load-errors.test.ts` を含む対象テストを実行し、GREEN で後方互換を確認する。
4. Task Seed の Tests/Commands セクションへ RED→GREEN ログを記録し、フォローアップ要否を Notes に追記する。

## Tests

- RED: `pnpm test -- tests/app/AppToolbar.spec.tsx` が `handleToolbarLoadProject` 未再エクスポートで失敗。【5bf776†L1-L24】
- RED: `pnpm test -- tests/lib/opfs.load-errors.test.ts` が `handleToolbarLoadProject` 未再エクスポートで失敗。【8629c4†L1-L24】
- GREEN: `pnpm test -- tests/app/AppToolbar.spec.tsx` が App 経由 import で全ケース成功。【636eb5†L1-L15】
- GREEN: `pnpm test -- tests/lib/opfs.load-errors.test.ts` が OPFS 例外ハンドリングを維持したまま成功。【afb9f4†L1-L6】【15a053†L1-L6】

## Commands

- RED: `pnpm test -- tests/app/AppToolbar.spec.tsx`。【5bf776†L1-L24】
- RED: `pnpm test -- tests/lib/opfs.load-errors.test.ts`。【8629c4†L1-L24】
- GREEN: `pnpm test -- tests/app/AppToolbar.spec.tsx`。【636eb5†L1-L15】
- GREEN: `pnpm test -- tests/lib/opfs.load-errors.test.ts`。【afb9f4†L1-L6】【15a053†L1-L6】

## Notes

- App 公開 API 経由のハンドラ参照が復旧し、後方互換確認コマンドも記録済み。
