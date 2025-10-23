---
template: rollout-phase
document_id: rollout.autosave-merge
owner: release-engineering
status: active
last_reviewed_at: 2025-01-18
next_review_due: 2025-02-01
---

# AutoSave & 精緻マージ ロールアウト管理テンプレート

## 1. メタデータ

```yaml
autosave_flag: autosave.enabled
merge_flag: merge.precision
collector_entrypoint: scripts/monitor/collect-metrics.ts
analyzer_job: pnpm run monitor:analyze --phase <phase>
reporter_job: pnpm run monitor:notify --phase <phase>
slack_channels:
  autosave: "#launch-autosave"
  merge: "#merge-ops"
pagerduty_services:
  autosave: "Autosave & Precision Merge"
  merge: "Merge Duty"
```

## 2. Scope

- **In**:
  - AutoSave / 精緻マージ フラグ運用（`docs/CONFIG_FLAGS.md`, `governance/policy.yaml`）
  - Day8 Collector→Analyzer→Reporter パイプラインで監視・通知するメトリクス定義
  - 15 分 ETL サイクルにおけるロールバック基準と通知テンプレート（`templates/alerts/rollback.md`）
- **Out**:
  - フロントエンド UI の詳細仕様（`docs/AUTOSAVE-INDICATOR-UI.md`, `docs/MERGE-DESIGN-IMPL.md` を参照）
  - Lock/OPFS 実装、CLI 詳細、Day8 Analyzer/Reporter のコード実装
  - Incident RCA 手順の詳細（`reports/rca/` 運用ルール）

## 3. フェーズ管理対象

| フェーズ | 既定フラグ (`autosave.enabled` / `merge.precision`) | Collector 収集対象 | Analyzer 判定指標 & 閾値 | Reporter 通知 & ロールバック |
| --- | --- | --- | --- | --- |
| Phase A-0 (準備) | `false` / `legacy` | JSONL 整合性、`autosave_p95` ベースライン | 判定なし（手動レビューのみ） | Slack `#launch-autosave` で準備状況共有。`flags:rollback` 非適用 |
| Phase A-1 (QA Canary) | `true` (QA のみ) / `legacy` | `autosave_p95`, `restore_success_rate` | `autosave_p95` ≤ 2500ms、`restore_success_rate` ≥ 0.995 | Slack `#launch-autosave`（warning）、重大時 PagerDuty *Autosave & Precision Merge*。ロールバック: `pnpm run flags:rollback --phase A-0` |
| Phase A-2 (β導入) | `true` / `legacy` | `restore_success_rate`, `autosave_incident_rate` | `restore_success_rate` ≥ 0.995、クラッシュ率 Δ≤+5% | Slack `#launch-autosave` + PagerDuty（P2）。ロールバック: `pnpm run flags:rollback --phase A-1` |
| Phase B-0 (Merge β) | `true` / `beta` | `merge_auto_success_rate`, `merge_conflict_rate` | `merge_auto_success_rate` ≥ 0.80（15 分窓） | Slack `#merge-ops`、PagerDuty *Merge Duty*。ロールバック: `pnpm run flags:rollback --phase A-2` |
| Phase B-1 (GA) | `true` / `stable` | AutoSave/Merge 指標全件 | AutoSave/Merge SLO を 5 日連続達成、重大事故 0 件 | PagerDuty Incident-001（P1） + Slack `#incident`。ロールバック: `pnpm run flags:rollback --phase B-0` |

- Collector は各フェーズで `observed_only` タグを付与し Day8 Analyzer と同期する。
- Analyzer は `rollback_required` フラグを集約し、Reporter へ通知レベルを指示する。

## 4. フェーズ管理非対象（モニタリングのみ）

| 項目 | 理由 | タグ | 監視タイミング | 担当 |
| --- | --- | --- | --- | --- |
| `merge.precision`=`legacy` 時の Diff タブ UI | Phase B-0 以前は露出しない | `observed_only=true` | Phase A-0〜A-2 | プロダクト QA |
| AutoSave Canary 外ユーザーの保存成否 | Canary 外はフラグ未展開 | `tenant=standard` | Phase A-1 | Collector (ログ保持のみ) |
| ステージング環境の `merge.precision` | 本番ロールアウト前テスト | `environment=staging` | Phase B-0 | Analyzer (レビュー記録のみ) |
| `flags:rollback` ドライラン演習 | 手順確認であり実フェーズ判定外 | `dry_run=true` | 全フェーズ | Reporter (docs/rehearsal/ へ保管) |

> **備考**: 非対象項目も JSONL には記録するが、Analyzer の SLO 判定には含めない。Collector はタグを明示し、Reporter は脚注として日次サマリに掲載する。

## 5. 運用メモ

- フェーズ遷移前に本テンプレートと `governance/policy.yaml` の該当セクションを同時更新する。
- Day8 アーキテクチャ（Collector→Analyzer→Reporter）の責務境界を維持し、通知テンプレートは `templates/alerts/rollback.md` を既定とする。
- `scripts/monitor/collect-metrics.ts` の `--simulate-breach` / `--simulate-latency` はフェーズ演習で利用し、実稼働モードでは無効化する。
- ロールバック後は Phase を 1 段階戻し、Canary から再開する。RCA は 1 営業日以内に `reports/rca/` へ格納する。

## 6. Day8 15 分 ETL & 通知経路設計図

```mermaid
flowchart LR
    Collector[Collector\n(pnpm ts-node scripts/monitor/collect-metrics.ts)] -->|JSONL 15m 窓| Analyzer[Analyzer\n(pnpm run monitor:analyze, monitor:score)]
    Analyzer -->|SLO 判定 JSON| Reporter[Reporter\n(pnpm run monitor:report, monitor:notify)]
    Reporter -->|Slack #launch-autosave/#merge-ops| Slack[(Slack)]
    Reporter -->|PagerDuty Incident-001| PagerDuty[(PagerDuty)]
    Reporter -->|rollback.command| Flags[pnpm run flags:rollback --phase <prev>]
    Flags --> Reporter
```

- Collector は §2.1 の ETL スロットに従い **0–7 分**で入力 JSONL を正規化し、Analyzer が **7–12 分**で SLO 判定・`rollback_required` を出力する。Reporter は **12–15 分**で通知テンプレートを適用し、Slack/PagerDuty/ロールバックの経路へ配送する。
- `scripts/monitor/collect-metrics.ts` は `window=15m` を既定とし、`reports/monitoring/<timestamp>.jsonl` のスキーマ整合を保証する。
- Day8 設計図（`Day8/docs/day8/design/03_architecture.md`）に準拠し、Collector→Analyzer→Reporter の責務境界と承認フロー（Slack→PagerDuty）の順序を固定する。

| フェーズ | 収集窓 | 主コマンド | 主要 I/O | 通知経路 | ロールバック経路 |
| --- | --- | --- | --- | --- | --- |
| Collector | 00:00–07:00 | `pnpm ts-node scripts/monitor/collect-metrics.ts --window=15m` | 入力: `reports/canary/phase-*.jsonl`<br>出力: `reports/monitoring/<timestamp>.jsonl` | - | `retryable=false` 時は Analyzer へ `rollback_required` を通知 | 
| Analyzer | 07:00–12:00 | `pnpm run monitor:analyze --phase <phase>`<br>`pnpm run monitor:score --phase <phase>` | 入力: Collector 出力 JSONL<br>出力: `monitor:score`（`breach`,`rollbackTo` 等） | - | `rollback_required=true` の場合 Reporter に `rollbackTo` 指定 |
| Reporter | 12:00–15:00 | `pnpm run monitor:report --phase <phase>`<br>`pnpm run monitor:notify --phase <phase>` | 入力: Analyzer 判定 JSON<br>出力: Slack/PagerDuty/RCA テンプレ、`reports/alerts/<timestamp>.md` | Slack `#launch-autosave`, `#merge-ops`, `#incident`<br>PagerDuty Incident-001 | `pnpm run flags:rollback --phase <prev>` を実行し結果を添付 |

## 7. SLO・通知テンプレ・ロールバック TDD 計画

1. **SLO 正規化ユニット**: `tests/monitoring/collector.metrics.test.ts` で `calculateWindowMetrics(window=15m)` が `autosave_p95` / `restore_success_rate` / `merge_auto_success_rate` を正規化する境界条件を RED→GREEN で検証する。
2. **通知テンプレ統合**: `tests/monitoring/collector.notifications.test.ts` で `--simulate-breach` により Reporter へ送る `AlertPayload` が `templates/alerts/rollback.md` の Slack/PagerDuty セクションを網羅することをモック検証する。
3. **ロールバックコマンド起動**: `tests/monitoring/collector.rollback.test.ts` で Analyzer モックが `rollback_required=true` を返すケースに対し、Reporter が `pnpm run flags:rollback --phase <prev>` を実行し、成功/失敗ログを通知へ埋め込むことを確認する。
4. **再試行・エスカレーション**: `tests/monitoring/collector.retry.test.ts` で Collector の I/O 障害（`retryable=true/false`）を模擬し、PagerDuty 連携が Incident-001 (P1/P2) を適切に切替えることを確認する。
5. **15 分 ETL E2E**: `tests/monitoring/collector.e2e.test.ts` から `pnpm ts-node scripts/monitor/collect-metrics.ts --window=15m --dry-run` を実行し、Collector→Analyzer→Reporter のハンドオフ JSON が Day8 アーキテクチャと一致することを検証する。

## 8. インシデント対応チェックリスト & ダッシュボード要件

| ステップ | チェック内容 | PagerDuty/Slack 連携 | Runbook/ログ連携 | 判定基準 |
| --- | --- | --- | --- | --- |
| 1. アラート受付 | Analyzer から `breach=true` の通知を受領し、フェーズを確認する。 | Slack `#launch-autosave` / `#merge-ops` 自動投稿、重大時 PagerDuty Incident-001 (P1/P2)。 | Runbook Step 1 (`governance/policy.yaml`) にコメントを残し、`reports/monitoring/` に証跡を保存。 | 判定 JSON の `phase` と `rollbackTo` がテンプレートと一致。 |
| 2. エスカレーション判断 | `rollback_required` 有無と通知レベルを決定する。 | Slack スレッドで `@oncall` メンション、PagerDuty ack 状況を同期。 | Runbook Step 2 を更新し、テンプレへリンクを記載。 | `rollback_required=true` なら 15 分以内に判断完了。 |
| 3. ロールバック実行 | `pnpm run flags:rollback --phase <prev>` を実行し、結果ログを Reporter へ渡す。 | PagerDuty Incident-001 のタイムラインへコマンドログを添付、Slack `#incident` で報告。 | Runbook Step 3 と `reports/alerts/<timestamp>.md` に出力を保存。 | 実行ログに `ExitCode=0` が記録されている。 |
| 4. RCA 着手 | 1 サイクル以内に RCA ドラフトを作成しオーナーを割り当てる。 | Slack `#incident` に RCA 雛形を共有。 | Runbook Step 4 を更新し、`reports/rca/` にファイル作成。 | 担当者・期限が Slack スレッドで確認できる。 |
| 5. クローズ確認 | SLO 緑化 2 サイクル継続とインシデント解消を確認する。 | Slack `#incident` でクローズ告知、PagerDuty Incident-001 を Resolve。 | Runbook Step 5 とダッシュボード承認記録を更新。 | ダッシュボードに Incident ID とクローズ日時が反映。 |

| ダッシュボードビュー | 必須指標 | データソース | PagerDuty/Slack 表示 | 承認条件 |
| --- | --- | --- | --- | --- |
| AutoSave パネル | `autosave_p95`, `autosave_error_count`, 現行フェーズ | `reports/monitoring/*.jsonl` | Incident-001 連携バッジ、Slack `#launch-autosave` リンク | Reviewer が SLO 線と閾値を確認し承認サインを残す。 |
| Restore パネル | `restore_success_rate`, `rollback_required`, `retryable_failures` | Analyzer 出力 (`monitor:score`) | PagerDuty タイムラインと Runbook Step 3 へのリンク | Incident 対応ログが `reports/alerts/*.md` と一致。 |
| Merge パネル | `merge_auto_success_rate`, `merge_conflict_rate` | Analyzer 出力 (`monitor:score`) | Slack `#merge-ops` 通知へのディープリンク | Phase B 判定メモと一致。 |
| SLA/SLO 集計 | Phase 別 SLO 達成率、ロールバック回数 | `reports/monitoring/` + `reports/rca/` メタ | PagerDuty Incident 履歴 + Slack `#incident` スレッド | ガバナンスレビューで承認（議事録リンク添付）。 |
