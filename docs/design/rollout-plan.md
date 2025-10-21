# ロールアウト運用計画

本書は `docs/IMPLEMENTATION-PLAN.md` および関連 Runbook を基に、フェーズ基準・SLO 判定指標と運用フローを統合した資料である。フェーズ移行の意思決定とロールバック手順を運用チーム・QA・開発が共有することを目的とする。

## 1. フェーズ基準と既定値

| フェーズ | 想定ユーザー | フラグ既定値 (`autosave.enabled` / `merge.precision`) | 主要 SLO / KPI | ロールバック基準 | 備考 |
| --- | --- | --- | --- | --- | --- |
| Phase A-0 (準備) | 全ユーザー | `false` / `legacy` | 保存遅延 P95 ≤ 2.5s を維持 | 保存遅延 > 2.5s が 1 日 3 回以上 | 基本ライン。オフ状態の回帰試験を継続。 |
| Phase A-1 (QA Canary) | 開発・QA | `true` / `legacy` | 保存遅延 P95 ≤ 2.5s、復旧成功率 ≥ 99.5% | 保存遅延 > 2.5s または 復旧成功率 < 99.5% | `flags:rollback --phase A-0` を即時実行。 |
| Phase A-2 (β) | β 招待 | `true` / `legacy` | 復旧成功率 ≥ 99.5%、クラッシュ率増分 ≤ +5% | 復旧失敗率 ≥ 0.5% または クラッシュ率増分 > +5% | 失敗時は Phase A-1 から再開。 |
| Phase B-0 (Merge β) | β 招待 | `true` / `beta` | 自動マージ率 ≥ 80%、重大バグ ≤ 3 件/日 | 自動マージ率 < 80% または 重大バグ > 3 件/日 | Analyzer が 15 分粒度で算出。 |
| Phase B-1 (GA) | 全ユーザー | `true` / `stable` | AutoSave / マージ SLO を 5 日連続達成 | 任意 SLO 未達が 24 時間継続 または 重大事故 | ロールバック後 1 営業日以内に RCA 共有。 |

## 2. SLO 判定指標

| 指標 | 収集ソース | 判定タイミング | 判定条件 | 担当 |
| --- | --- | --- | --- | --- |
| 保存遅延 P95 | `autosave.save.completed` | `collect-metrics` 実行ごと (15 分間隔) | 直近 2h の P95 ≤ 2.5s | Collector が収集、Analyzer が算出 |
| 復旧成功率 | `autosave.restore.result` | QA 実施後 / β 連続監視 | 成功率 ≥ 99.5% | Analyzer が集計、Reporter が Runbook 記録 |
| クラッシュ率増分 | クラッシュログ | β 監視 (日次) | baseline +5% 以内 | Analyzer |
| 自動マージ率 | `merge.diff.apply` | Merge β/GA 期間 (15 分粒度) | ≥ 80% を維持 | Analyzer |
| 重大バグ件数 | Reporter 起票 | 日次レビュー | ≤ 3 件/日 | Reporter |

## 3. 運用コマンドと監視フロー

1. **テレメトリ収集**: `pnpm tsx scripts/monitor/collect-metrics.ts --window=15m --output=reports/monitoring/$(date +%Y%m%d%H%M).jsonl`
   - Collector が 15 分粒度のイベント (`autosave.*`, `merge.*`) を取得し JSONL へ保存。
   - 実行ログは `reports/monitoring/` に保存し、SLO ダッシュボードと突合する。
2. **Analyzer 判定**: 収集ファイルを `analyzer/ingest.py --input reports/monitoring/...` に渡し、SLO 判定レポートを生成。
   - 判定結果は Reporter が承認し Runbook に記録。
3. **SLO 違反時の再試行**: `collect-metrics` を再実行し、`retryable=true` の場合は指数バックオフ (0.5s→1s→2s→4s→8s) を最大 5 回実施。
4. **ロールバック判定**: SLO 未達が 24 時間継続した場合、`pnpm run flags:rollback --phase <prev>` を実行。
   - 実行後、UI へ `autosave.lock.readonly` 通知を発行し、Reporter がロールバック時刻・原因・再開条件を Slack テンプレートに沿って記録。
5. **復旧確認**: ロールバック後の保存遅延/マージ率を 2h 監視し、改善を確認したら Phase A-1 から再開。

## 4. 通知テンプレートと責務分担

| 業務 | 当番 | トリガー | 利用テンプレート | 主なアウトプット |
| --- | --- | --- | --- | --- |
| テレメトリ収集 (Collector) | SRE | フェーズ移行期間中の 15 分間隔バッチ | `collect-metrics` 実行ログ雛形 | `reports/monitoring/*.jsonl` と実行ログ |
| SLO 判定・承認 (Analyzer) | Data QA | Collector 出力受領後 | `analyzer/summary.md` | 判定レポート、再試行要否コメント |
| ロールバック通知 (Reporter) | プロダクトオーナー | `flags:rollback` 実行時 | Slack `#launch-autosave` テンプレート | ロールバック理由、次回 Canary 日程 |
| 日次共有 | プロダクトオーナー | 監視完了後 | Runbook 日次記録フォーム | 進捗と未解決課題 |

## 5. 監視・ロールバック Runbook リンク

- 監視手順: 本書のセクション 3 を参照し、各実行ログを Runbook の「観測」セクションへ追記する。
- ロールバック手順: `flags:rollback --phase <prev>` 実行後に Slack テンプレートを用い、Reporter が決裁者と共有する。
- フェーズ移行チェック: セクション 1 と 2 の指標を満たしたことを Analyzer が承認し、QA が `docs/CHECKLIST.md` の該当項目を完了する。
