# AutoSave/精緻マージ ロールアウト SLO チェックリスト

## 2024-03-27 進捗ログ
- ✅ Implementation Plan 0.2.3-1/2: `resolveAutoSaveBootstrapPlan` が `resolveFlags()`・`resolveAutoSavePolicy()` 経由で `FlagSnapshot` と固定ポリシーを解決し、App ブートストラップでガード判定に使用できる状態。テレメトリは `collectFlagResolutionPayloads` → `publishFlagResolution` 経路で Day8 Collector へ送出済み。
- ✅ Implementation Plan 0.2.3-4 / docs/AUTOSAVE-DESIGN-IMPL: フェーズ A ポリシー（デバウンス500ms/アイドル2s/履歴20世代・50MB）と `FlagValidationError` のソース付与がテレメトリに反映され、VS Code ブリッジ経由でも同一スナップショットを共有可能。
- ⏳ Implementation Plan 0.2.3-5: Phase-b0 でのレガシー localStorage 参照削除は未着手。`createFlagSnapshotSubscription` のフェールセーフを段階的に縮退させるタスクを作成し、Collector 側の `flag_resolution` 安定化を確認後に実施する。
  - 次アクション: Flag refresh 通知の重複送信計測と `FLAG_MIGRATION_PLAN` exit criteria のレビュー記録を追加。`reports/today.md` に計測結果を追記するタスクを発行。
- ⏳ Implementation Plan 0.2.3-6: `plugins.enable` 配布は Phase-a1 ガード下でテレメトリ確認中。`collectFlagResolutionPayloads()` が `plugins.enable` を含む `flag_resolution` を送出しているが、QA への恒常配布は未実施。
  - 現状: `resolvePluginBridgeBootstrapPlan()` のブートストラップで計測された `evaluationMs` を含むテレメトリが Day8 Collector で監査待ち。
  - 次アクション: `flags:set plugins.enable true` → `flags:push --env qa` のドライランを完了し、`retryable=false` エラーが 3 回連続した場合に `flags:rollback --phase phase-a0` と VS Code ワークスペース／`localStorage.plugins.enable` をクリアするオペレーション手順を記録。

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

## 関係者共有テンプレート
- **PR コメント:**
  > resolveAutoSaveBootstrapPlan / telemetry integration のフェーズ A 要件が完了しました。App ブートストラップと VS Code ブリッジの両方で FlagSnapshot 経由のガード判定に移行済みです。Phase-b0 でのローカルストレージ縮退のみ残タスクとして追跡します。
- **Slack (#autosave-canary):**
  > [更新] FlagSnapshot ベースの AutoSave ブートストラップと flag_resolution テレメトリが collector 反映まで完了。Phase-b0 のローカルストレージ撤去タスクを別途起票予定です。Collector 監視に追加の異常があれば共有ください。
