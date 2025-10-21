# C. Day8 ペルソナスキーマ（Katamari 版）

Day8 の運用ログと CI 成果物を整理するうえで、Collector/Analyzer/Reporter/Proposer/Governance の各ロールが担う責務と、
ハンドオフ時に必要なメタデータを統一するためのスキーマを定義する。

## 目的
- CI ラン単位の運用ログから誰がどの情報を引き継ぐかを明確にし、Birdseye や Why-Why に反映する。 
- Task Seed 起票や評価指標策定時に、ロールごとの視点・ログ断面・完了条件をぶれなく記述する。 
- Collector → Analyzer → Reporter → Proposer → Governance の順に、再現性の高いハンドオフを保証する。

## 必須フィールド
| フィールド | 型 | 説明 |
| --- | --- | --- |
| `persona_id` | string | `day8-<role>-<slug>` 形式の識別子。運用ログと Birdseye のノード名に共通化する。 |
| `role` | enum | `Collector`/`Analyzer`/`Reporter`/`Proposer`/`Governance` のいずれか。ハンドオフ順序を制御する。 |
| `mission` | string | 当該ロールが運用ログから引き出すべきゴール（例: 失敗原因の一次切り分け、提案の優先度付け）。 |
| `log_slice` | object | 対象となる CI ランやモニタリング出力の断面。`source`（例: `whywhy://run/123`）と `filters`（例: `severity >= warn`）を含める。 |
| `insights_required` | array[string] | そのロールが評価指標・Task Seed に書き残すべき観点。定量指標名や DSL フィールドを列挙する。 |
| `handoff` | object | 次ロールへの引き継ぎ条件。`to`（次ロール名）、`deliverables`（JSON/Markdown/チェックリストなどの型）、`quality_gate`（合格条件）。 |
| `operations_hooks` | array[object] | PagerDuty/GitHub Projects など運用連携の Webhook 設定。`service`, `event`, `on_failure` を必須にする。 |
| `review_cadence` | string | ロールオーナーがログを見直す頻度（例: "per-run", "per-incident", "weekly"）。 |
| `escalation` | object | 再試行/エスカレーション先。`retryable`（bool）、`contact`、`notes` を含めて再発防止のアクションを紐づける。 |

## サンプル
```yaml
persona_id: "day8-collector-ci"
role: "Collector"
mission: "CI 失敗ランから運用ログとテストメトリクスをロスなく収集する"
log_slice:
  source: "logs://ci/run-2025-10-23-0421"
  filters:
    - key: "stage"
      op: "in"
      values: ["test", "post-check"]
insights_required:
  - "metrics.total_failures"
  - "artifacts.whywhy.draft_path"
handoff:
  to: "Analyzer"
  deliverables:
    - type: "json"
      path: "reports/run-2025-10-23-0421/collector.json"
  quality_gate:
    - "all required artifacts present"
    - "log coverage >= 95%"
operations_hooks:
  - service: "pagerduty"
    event: "ci-failure"
    on_failure: "notify-runbook://collector"
review_cadence: "per-run"
escalation:
  retryable: true
  contact: "#day8-oncall"
  notes: "再現不能なログ欠損時は SRE へ即時連絡"
```
