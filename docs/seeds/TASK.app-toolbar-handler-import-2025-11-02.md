# Task Seed

## メタデータ

```yaml
task_id: 20251102-01
repo: local://Conimgponic
base_branch: main
work_branch: work
priority: P0
langs: [typescript]
status: active
last_reviewed_at: 2025-11-02
next_review_due: 2025-11-09
```

## Objective

`src/App.tsx` のツールバーが Day8 ガードレールに反して未定義ハンドラを参照している問題を、`src/toolbar/handlers.ts` の正式 API に統一し ReferenceError を解消する。

## 背景と根拠

- `Day8/workflow-cookbook/HUB.codex.md` が要求する「副作用ロジックの専用モジュール集約」を逸脱していた。
- `Day8/docs/TASKS.md` および `Day8/workflow-cookbook/GUARDRAILS.md` の TDD / 最小差分方針に従い、`src/App.tsx` を正規ハンドラ import へ揃える必要がある。

## Scope

- In: `src/App.tsx`, `tests/app/AppToolbar.spec.tsx`, `scripts/test/run-selected.ts`
- Out: autosave・MergeDock・テンプレート UI 一式

## Requirements

- `src/App.tsx` が `handleToolbarLoadProject` / `handleToolbarPackageExport` を `src/toolbar/handlers` から単一 import で参照すること。
- `tests/app/AppToolbar.spec.tsx` で import 形状を検証し、`pnpm test --filter "AppToolbar"` を RED→GREEN で実行すること。
- `scripts/test/run-selected.ts` に `AppToolbar` フィルタ定義を追加し、Day8 ガイドの TDD 手順を満たすこと。

## Affected Paths

- src/App.tsx
- tests/app/AppToolbar.spec.tsx
- scripts/test/run-selected.ts

## Tests

- RED: `pnpm test --filter "AppToolbar"` （新規検証が失敗）【28f69e†L1-L20】
- GREEN: `pnpm test --filter "AppToolbar"` （修正後成功）【d6e4ad†L1-L14】

## Notes

- HUB/GUARDRAILS 参照済み。Public API には変更なし。
- `Day8/docs/day8/guides/07_contributing.md` の「1タスク=1ブランチ=1PR」ルール順守済み。
