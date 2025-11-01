# Task Seed

## メタデータ

```yaml
task_id: 20251101-01
repo: local://Conimgponic
base_branch: main
work_branch: feat/app-toolbar-io-refactor
priority: P1
langs: [typescript]
status: draft
last_reviewed_at: 2025-11-01
next_review_due: 2025-11-08
```

## Objective

`src/App.tsx` に集約されているツールバーの保存/読込/エクスポート I/O ハンドラを `src/toolbar/handlers.ts` に分離し、UI レイヤーから副作用ロジックを隔離する。

## Scope

- In: `src/App.tsx`, `src/toolbar/handlers.ts`, `tests/app/AppToolbar.spec.tsx`
- Out: autosave フロー、MergeDock 実装、テンプレート同期ロジック全般

## Requirements

- Behavior:
  - `handleToolbarSaveProject`/`handleToolbarLoadProject`/`handleToolbarPackageExport` が現行どおり例外時にアラートとコンソールログを発火すること。
  - 成功時の I/O もテレメトリへ副作用を波及させず、依存は注入された関数に限定すること。
- I/O Contract:
  - 入力: `Storyboard`, OPFS ラッパー (`saveJSON`/`loadJSON`), `buildPackage`, `createDownload` コールバック。
  - 出力: UI イベントハンドラからの Promise 解決/拒否、および `alert`/`consoleError` 呼び出し。
- Constraints:
  - `Day8/workflow-cookbook/HUB.codex.md` と `Day8/docs/TASKS.md` が示す「1タスク=1PR」「副作用の隔離」を遵守する。
  - 既存の `tests/app/AppToolbar.spec.tsx` を拡張し、TDD で成功/失敗シナリオを RED→GREEN で検証する。
- Acceptance Criteria:
  - `src/App.tsx` のガードレール (>400 行時分割) に抵触しない構造へ移行できること。
  - 新モジュールを経由しても OPFS 例外メッセージ/ログフォーマットが一致すること。

## Affected Paths

- src/App.tsx
- src/toolbar/handlers.ts
- tests/app/AppToolbar.spec.tsx

## Local Commands（存在するものだけ実行）

```bash
pnpm test
```

## Deliverables

- PR: Intent `INT-001`, ツールバー I/O 分離の設計サマリ、テストログ添付
- チェックリスト: OPFS 例外通知が保持されること、UI からの呼び出しが新モジュール経由であること

---

## Plan

1. `tests/app/AppToolbar.spec.tsx` に成功シナリオのユニットテストを追加し、既存失敗シナリオと併せて RED 状態を確認する。
2. `src/toolbar/handlers.ts` を新設し、`ToolbarNotifiers` と 3 つのハンドラを型付き API として移設する。
3. `src/App.tsx` から該当ロジックを削除し、新モジュールを import して UI ハンドラから呼び出す構造へ変更する。
4. `pnpm test` を実行して新旧シナリオが GREEN になること、および既知の telemetry テスト失敗が変化しないことを確認する。

## Patch

_初回ドラフトのため実装なし。_

## Tests

- `pnpm test` （telemetry 系テストは既知の失敗: `tests/app/flags.telemetry.test.tsx` での期待件数差異）【8fe4a7†L1-L104】

## Commands

- `pnpm test`

## Notes

- Day8 HUB/TASKS ガイドラインに沿って Task Seed を配置。
- Telemetry テストは既存の期待件数差異により失敗するため、後続タスクでフォローアップが必要。
