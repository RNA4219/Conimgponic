# AutoSave/精緻マージ ロールアウト監視・ロールバック設計

本ドキュメントは [AutoSave 実装詳細](../AUTOSAVE-DESIGN-IMPL.md) および Day8 ロールアウトアーキテクチャ([Day8/docs/day8/design/03_architecture.md](../../Day8/docs/day8/design/03_architecture.md))に基づき、Collector→Analyzer→Reporter パイプラインとフェーズゲート運用下での監視・通知・ロールバック方針を定義する。

## 1. フェーズ構成と責務

| フェーズ | 期間 | 主要責務 | 成功条件 | 移行判定主体 |
| --- | --- | --- | --- | --- |
| Phase A (Canary) | 対象ユーザ 5% | Collector 手動実行 (`pnpm tsx scripts/monitor/collect-metrics.ts --window=15m`) とログ妥当性確認 | 連続 8 バッチで SLO 満たす | SRE + Dev Lead |
| Phase B (Broad) | 対象ユーザ 30% | Analyzer による自動判定、Reporter の Slack 告知 | 24h 連続で SLO 遵守、重大アラート 0 件 | SRE |
| Phase C (Default) | 対象ユーザ 100% | Reporter の日次レポートと Governance 承認 | 72h 連続で SLO 遵守、Slack 通知テンプレートに incident なし | Governance 委員会 |

- 各フェーズとも Collector は 15 分間隔サイクルを厳守し、遅延が 5 分を超えた場合は Analyzer へ「収集遅延」イベントを送出する。
- Analyzer は `autosave` テレメトリの P95 保存遅延、エラー率、履歴整合性指標を算出し、Reporter に判定結果を連携する。
- Reporter は Slack 通知・ダッシュボード更新・ロールバック Runbook 呼び出しを担当する。

## 2. 監視フロー

```mermaid
flowchart LR
  subgraph Collector
    C0[collect-metrics.ts] -->|JSONL (15m window)| C1[logs/autosave/<ts>.jsonl]
  end
  subgraph Analyzer
    C1 --> A0[Batch ingest]
    A0 --> A1[Metric calc (P95, error_rate, history_drift)]
    A1 --> A2[SLO gate per phase]
  end
  subgraph Reporter
    A2 --> R0[Decision engine]
    R0 -->|OK| R1[Dashboard update]
    R0 -->|Warn| R2[Slack: autosave-warn]
    R0 -->|Violation| R3[Slack: autosave-incident]
    R3 --> RB[Rollback Runbook]
  end
  RB -->|cli rollback --target=autosave| Ops[(Release Ops)]
```

- JSONL 入力は Phase 共通で `workflow-cookbook/logs/autosave/` に集約し、Collector が 15 分サイクルを維持する。
- Analyzer の SLO ゲートはフェーズ別閾値表（後述）を参照し、Violation 判定時は `rollback_required=true` を付与して Reporter へ送信する。
- Reporter は通知種別ごとに Slack テンプレートを適用し、Incident 判定は Runbook を即時起動する。

## 3. SLO 定義

| 指標 | 収集粒度 | Phase A 閾値 | Phase B 閾値 | Phase C 閾値 | ノート |
| --- | --- | --- | --- | --- | --- |
| 保存遅延 P95 (`autosave.save.completed`) | 15 分バッチ | ≤ 2.5s | ≤ 2.0s | ≤ 1.8s | `AUTOSAVE_DEFAULTS` のデバウンス+アイドルを考慮し、Phase 進行で厳格化。 |
| 失敗率 (`autosave.save.error`) | 15 分バッチ | ≤ 1.0% | ≤ 0.5% | ≤ 0.3% | `AutoSaveError` の retryable を Collector が集約。 |
| 履歴整合性逸脱 (`autosave.history.drift`) | 1 時間移動平均 | = 0 | = 0 | = 0 | `current.json` と `index.json` の差分検知イベント。 |
| Collector 遅延 (`collector.latency`) | 15 分バッチ | ≤ 3m | ≤ 2m | ≤ 2m | 15 分サイクル内に終了すること。 |

- Analyzer はフェーズに応じた閾値を `governance/policy.yaml` のロールアウト章へ同期し、Reporter からのフィードバックを Collector に戻すループを維持する。

## 4. SLO 検証チェックリスト

1. `pnpm tsx scripts/monitor/collect-metrics.ts --window=15m --output=reports/monitoring/<ts>.jsonl` を実行し、最新 2h の JSONL を取得。
2. Analyzer のシミュレーションモードで `--phase=<A|B|C>` を指定し、SLO 判定を Dry-run。
3. ダッシュボードの P95 カードと JSONL 集計値が ±5% 以内で一致することを確認。
4. `autosave.history.drift` 指標が 0 であること、異常時は GC の `maxGenerations` ログと照合。
5. Slack テンプレートの `phase`, `window`, `metrics` プレースホルダが埋まっているスクリーンショットを添付。
6. SLO 違反時の `rollback_required` フラグが Reporter → Runbook で消失していないことを Incident ログで確認。

## 5. 通知テンプレート一覧

| テンプレート ID | 利用フェーズ | チャンネル | トリガー | フォーマット例 |
| --- | --- | --- | --- | --- |
| `autosave-ok` | 全フェーズ | Slack `#autosave-rollout` | SLO 準拠 | "✅ AutoSave {phase} OK / window={window} / p95={p95}s / err={err_rate}%" |
| `autosave-warn` | Phase A/B | Slack `#autosave-rollout` | SLO 接近 (80% 閾値超) | "⚠️ AutoSave {phase} nearing limits / p95={p95}s / err={err_rate}% / action=watch" |
| `autosave-incident` | 全フェーズ | Slack `#incident-autosave` | SLO 違反 (`rollback_required=true`) | "🚨 AutoSave {phase} violation / metric={metric} / window={window} / rollback={cmd}" |
| `autosave-rollback` | 全フェーズ | Runbook 自動コメント | ロールバック実行時 | "Rollback invoked: `{cmd}` / initiated_by={initiator} / reason={metric}" |

- Reporter は `autosave-incident` 送信後、自動的に `autosave-rollback` エントリを Runbook ログに記載する。OK 通知は Dashboard 更新後の確認用として Phase B 以降に自動送信する。

## 6. ロールバック Runbook

1. Reporter の Incident 通知から `rollback_required=true` を確認し、`cmd` フィールドをコピー。
2. `pnpm tsx scripts/monitor/collect-metrics.ts --window=15m --phase=<current>` を停止。
3. `cli rollback --target=autosave --phase=<current> --reason="{metric} violation"` を実行。
4. ガード: ロールバックは 1 フェーズ分のみ段階的に戻す（例: Phase C→B）。
5. Rollback 後 30 分間は Collector を 5 分間隔で手動実行し、SLO が回復したことを確認。
6. Incident レポートに `autosave-rollback` テンプレート出力を貼付し、Governance 承認を取得。

## 7. テスト計画

### 7.1 シミュレーション
- Analyzer を `--dry-run --fixture=tests/fixtures/autosave_phaseA_violation.jsonl` で実行し、Violation → Rollback の分岐を確認。
- `collect-metrics.ts` を `--window=15m --simulate-latency=180s` で起動し、Collector 遅延アラートが Slack `autosave-warn` に送信されることを mock で検証。

### 7.2 ダッシュボード確認
- Reporter が更新する `reports/monitoring/dashboard.json` の P95 値が実際の JSONL 集計と一致することを 15 分おきに確認。
- Incident 期間中はダッシュボードの `rollback_active=true` バナーが表示され、解除後 1 サイクルで false に戻ることを確認。

### 7.3 回帰テスト
- `scripts/monitor/collect-metrics.ts` の JSONL スキーマ変更がないことをスキーマ検証で確認。
- Slack テンプレートのレンダリングユニットテストで全プレースホルダが埋まることを保証。

## 8. 変更管理

- 本設計に基づく閾値やテンプレート変更は `governance/policy.yaml` と `docs/design/autosave-merge-rollout.md` を同期更新する。
- ダッシュボード定義を更新する際は Incident 発生中の計測を優先し、Collector サイクル停止を 5 分以内に留める。

