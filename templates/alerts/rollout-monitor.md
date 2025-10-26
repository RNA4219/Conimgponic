# Rollout Monitor Notification Template

## Slack 投稿フロー（Canary / GA）
- Canary 期間: `#autosave-canary` へ投稿し、`@oncall-autosave` をメンション。重大違反時はスレッドで `#merge-ops` をクロスポスト。
- GA 期間: `#autosave-ga` へ投稿し、クリティカル時は `#incident` へフォローアップ。Merge 系メトリクス違反は `#merge-ops` を CC。
- 件名フォーマット: `[Rollout Monitor][Phase <phase>] <metric> breach (<value>/<threshold>)`
- 本文必須項目:
  1. 発生ウィンドウ（UTC/JST）と対象フェーズ（`A-1` / `A-2` / `B-0` / `B-1`）。
  2. トリガー指標と閾値、`retryable` 判定、Analyzer からの `rollback_required` フラグ。
  3. 対応ステップ: `pnpm run monitor:report --phase <phase>` 実行ログ、必要なら `pnpm run flags:rollback --phase <prev>` の結果要約。
  4. Runbook リンク: `scripts/monitor/README.md#reporter-ハンドオフ` と `governance/policy.yaml#rollout.monitoring`。
- 添付ファイル: 最新 `reports/monitoring/<timestamp>.jsonl`、Analyzer 判定 JSON、`reports/rca/<phase>-<date>.md` プレースホルダー。
- ハッシュタグ: `#autosave`、`#merge`、`#incident`（状況に応じて複数指定）。

### メトリクス監視サマリ（Slack 引用用）
| Phase | チャネル | メトリクス | 閾値 | エスカレーション | ロールバック |
| --- | --- | --- | --- | --- | --- |
| A-1 (QA Canary) | `#autosave-canary` | `autosave_p95` | ≤ 2500ms | Slack Warning | `pnpm run flags:rollback --phase A-0`
| A-1 (QA Canary) | `#autosave-canary` | `restore_success_rate` | ≥ 0.995 | Slack + PagerDuty | `pnpm run flags:rollback --phase A-0`
| A-2 (β導入) | `#autosave-canary` | `restore_success_rate` | ≥ 0.997 | Slack + PagerDuty | `pnpm run flags:rollback --phase A-1`
| B-0 (Merge β) | `#merge-ops` | `merge_auto_success_rate` | ≥ 0.80 | Slack + PagerDuty | `pnpm run flags:rollback --phase A-2`
| B-1 (GA) | `#autosave-ga` | `merge_auto_success_rate` | ≥ 0.85 | Slack + PagerDuty + `#incident` | `pnpm run flags:rollback --phase B-0`

## PagerDuty Incident-001 ハンドオフ
- サービス: `Autosave & Precision Merge`
- 優先度: `P2`（Canary 重大違反）/`P1`（GA 重大違反）。
- インシデントタイトル: `[Rollout Monitor][Phase <phase>] <metric> breach`
- インシデント本文テンプレート:
  ```text
  Phase <phase> rollout monitor breach detected
  Metric: <metric>=<value> (threshold <threshold>)
  Retryable: <retryable>
  Rollback: <rollback_required> → pnpm run flags:rollback --phase <prev>
  Attachments: reports/monitoring/<timestamp>.jsonl, reports/rca/<phase>-<date>.md
  ```
- 追加ノート: Slack 投稿 URL、Analyzer 判定ファイル、`scripts/monitor/collect-metrics.ts#COLLECT_METRICS_CONTRACT.notifications` の参照行。

## Reporter 実行ガイド
1. Analyzer の出力を確認し `retryable=false` かつ `rollback_required=true` の場合は `pnpm run flags:rollback --phase <prev>` を即時実行。
2. 実行ログを `reports/rollback/<phase>-<timestamp>.md` に保存し、Slack/PagerDuty へリンク。
3. `pnpm run monitor:notify --phase <phase>` を実行し、本テンプレートを適用。
4. Incident Commander に RCA ドラフト作成（1 営業日以内）を依頼し、RCA テンプレートを添付。

## フェーズ移行チェックリスト更新メモ
- Canary→GA 切替時は本テンプレートのチャネルを `#autosave-ga` に更新し、`reports/rollout-monitoring-checklist.md` の該当項目をチェック。
- `reports/task-seed-rollout-monitoring.md` の完了条件に基づき、テンプレート更新ログを `reports/alerts/` に保存。
- `pnpm test --filter monitor` 実行結果と `pnpm lint --filter monitor` の抜粋を Slack スレッドへ添付。
