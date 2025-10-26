# Task: Integration & Review – AutoSave Telemetry Gate

## 背景
- Phase A では `App.tsx` の AutoSave 初期化時に `flag_resolution` を Day8Collector へ送信し、Collector→Analyzer→Reporter の監視を通す。
- 既存の `resolveAutoSaveBootstrapPlan()` がフラグスナップショット生成と同時に Collector 送出を担うため、App 側での重複 publish を抑止するタスク票が必要。

## ゴール
1. AutoSave 初期化フローで `flag_resolution` が 1 回のみ送信されることを Day8Collector モックで証明する。
2. Integration & Review ゲートとして lint→typecheck→対象テストの順で失敗ゼロを確認し、レビュー checklist に転記できる状態にする。

## ゲート順
1. **lint:** `pnpm lint` – React/TypeScript の静的解析がゼロ警告で終わることを確認する。
2. **typecheck:** `pnpm typecheck` – `initializeAppAutoSavePlan` の型境界と telemetry fallback が TypeScript で整合することを確認する。
3. **tests:**
   - `pnpm test tests/app/flags.telemetry.test.tsx` – Day8Collector モックで `flag_resolution` の 1 回送信を検証する。
   - `pnpm test -- --filter integration` – AutoSave / MergeDock 連携の既存統合テストが退行しないことを確認する。

## ロールバック指針
1. テストが失敗した場合は `initializeAppAutoSavePlan` 呼び出しを差し戻し、`App.tsx` 旧ロジックで Collector publish を復元する。
2. テレメトリがダブルカウントした場合は `Day8Collector.publish` の呼び出し履歴を `reports/telemetry/*.jsonl` で確認し、App 初期化ロジックを rollback する。

## 完了条件チェックリスト
- [ ] 上記ゲートコマンドを順に実行し、ログをレビューコメントへ添付した。
- [ ] `tests/app/flags.telemetry.test.tsx` の Day8Collector モックが `flag_resolution` を 1 件のみ受信している。
- [ ] ロールバック手順を Runbook（`Day8/workflow-cookbook/RUNBOOK.md`）と整合させた旨をレビューで確認した。
