# AutoSave/精緻マージ ロールアウト SLO チェックリスト

## Canary 前提条件
- [ ] `pnpm run flags:status` で Canary 対象が `autosave.enabled=true`、`merge.precision=beta` になっている。
- [ ] `telemetry/autosave/*.jsonl` が Collector に 15 分間隔で到達し、欠損がない（`logs/rollout/collector/canary/` を確認）。
- [ ] Analyzer プロファイル `autosave-rollout` のテスト実行が成功し、`reports/metrics/canary/latest.json` が生成される。
- [ ] Reporter が Canary チャンネル向けのダミー通知を送信し、ACK が 10 分以内に記録された。

## Canary 運用中
- [ ] 連続 6 バッチで `autosave_write_success_rate ≥ 99.5%`。
- [ ] 連続 6 バッチで `merge_precision_latency_p95 ≤ 4500ms`。
- [ ] `rollback_request_rate = 0` を維持し、Analyzer から警告が届いていない。
- [ ] 監査ログに `collector-missed-batch` が無い。
- [ ] Slack `#autosave-canary` の通知が `reports/daily/rollout-<date>.md` に転記されている。

## GA 移行判定
- [ ] Canary 前提条件および運用中項目を全て完了済み。
- [ ] `reports/rollout-monitoring-design.md` §7 の条件を満たしている（QA/Release Eng. 署名済み）。
- [ ] プロダクトオーナーが GA 推奨に承認コメントを残した。
- [ ] `templates/alerts/rollout-monitor.md` の通知チャンネルが `#autosave-ga` に切り替えられた。
- [ ] `pnpm run flags:set merge.precision stable --scope prod` のドライラン結果を添付。

## GA 運用中
- [ ] 連続 4 バッチで `autosave_write_success_rate ≥ 99.3%`。
- [ ] 連続 4 バッチで `merge_precision_latency_p95 ≤ 5000ms`。
- [ ] `incident_ack_latency_p90 ≤ 15m` を維持。
- [ ] ロールバック実施時は `reports/rollback/<phase>-<timestamp>.md` にログを格納し、Reporter が通知済み。
- [ ] `resolveFlags()` のスナップショットで `autosave.phase=phase-b` を確認。

## ロールバック後検証
- [ ] `pnpm run flags:rollback --phase <prev>` の結果が成功である。
- [ ] `resolveFlags()` 再実行時に `autosave.enabled=false` または `merge.precision=legacy` へ戻っている。
- [ ] Incident 後のポストモーテムが `reports/postmortem/<incident>.md` へ作成された。
- [ ] `reports/task-seed-rollout-monitoring.md` をもとにフォローアップタスクが作成された。
