# AutoSave/精緻マージ ロールアウト監視

Day8 パイプライン（Collector → Analyzer → Reporter）の責務を前提に、AutoSave/精緻マージ機能の段階導入を監視する。設計の根拠は `docs/AUTOSAVE-DESIGN-IMPL.md` および `Day8/docs/day8/design/03_architecture.md` を参照。

## 監視イベントの供給ポイント
| フェーズ | Collector 入力 | 抽出タイミング | 備考 |
| --- | --- | --- | --- |
| A-0/A-1 | `telemetry/autosave/*.jsonl` | 15 分毎の ETL ジョブ | AutoSave disabled の確認。Collector は `autosave.enabled=false` を SLO として追跡。 |
| A-2/B-0 | `telemetry/merge/*.jsonl` + `telemetry/autosave/*.jsonl` | 15 分 ETL (`--phase canary`) | Canary 群のみ対象。Collector は `phase-tag=canary` を付与し、Analyzer のフェーズ別集計へ引き渡す。 |
| B-1 | `telemetry/merge/*.jsonl` | 15 分 ETL (`--phase ga`) | GA 群では `autosave.phase=phase-b` を SLO 集計キーに含める。 |

## Analyzer 連携仕様
- `workflow-cookbook/scripts/analyze.py --profile autosave-rollout` を新設し、Collector からの JSONL を `phase`, `flag_snapshot` 単位で集約する。
- SLO 指標
  - `autosave_write_success_rate` ≥ 99.5%（15 分窓）
  - `merge_precision_latency_p95` ≤ 4500ms（Canary）、≤ 5000ms（GA）
  - `rollback_request_rate` = 0（警告: >0）
- Analyzer は警告発生時に `reports/alerts/pending/*.md` をエミットし、Reporter の通知フローを起動する。

## Reporter ハンドオフ
- Reporter は Analyzer からの `alerts/*.json` を読み取り、Slack テンプレート `templates/alerts/rollout-monitor.md` を使用。
- Canary 中のアラートは `#autosave-canary`、GA 移行後は `#autosave-ga` に送信。
- ロールバック指示時は `reports/rollback/<phase>-<timestamp>.md` を作成し、`pnpm run flags:rollback --phase <prev>` の実行ログ添付を必須とする。

## ロールバック再試行判定
| エラー種別 | 例外コード | 再試行可否 | 操作 |
| --- | --- | --- | --- |
| Collector アップロード失敗 | `collector-upload-failed` | 可（3 回まで） | Exponential backoff (1m, 4m, 9m)。3 回失敗で Analyzer へ incident flag。 |
| Analyzer 計算タイムアウト | `analyzer-timeout` | 可（1 回） | 再実行後も失敗なら Reporter へ Critical 送信。 |
| Reporter 通知 API 429 | `reporter-throttle` | 可（5 分後再実行） | Slack quota を確認。 |
| フラグ反映失敗 | `flags-rollback-failed` | 不可 | 即時エスカレーション（L3）し、Runbook で手動復旧。 |

## Canary → GA 移行条件
1. 連続 48h の `autosave_write_success_rate` ≥ 99.5% を確認。
2. `merge_precision_latency_p95` が 6 連続 ETL バッチで上限内。
3. ロールバック発生数 0、もしくは 1 回以内かつ原因が Collector 起因で再発防止策が Reporter に記録されている。
4. QA が `reports/rollout-monitoring-checklist.md` の Canary セクションを完了済み。

GA 宣言後 24h は Canary モードを維持し、`flags:set merge.precision stable --scope canary` を廃止する前に `reports/rollout-monitoring-design.md` の手順でフォールバック確認を実施する。
