# AutoSave/精緻マージ フェーズ管理テンプレート

本テンプレートは `docs/IMPLEMENTATION-PLAN.md` §2.1 と `docs/design/autosave-merge-rollout.md` の運用条件を整理し、フェーズ管理の対象・非対象を明確化する。Collector→Analyzer→Reporter パイプラインの責務は Day8 アーキテクチャ図を参照し、各フェーズの運用資料に転記する。

## 1. フェーズ定義テンプレート

| フェーズ | 管理対象コンポーネント | 管理対象アクティビティ | 非対象（除外理由） | 主担当 | 参考資料 |
| --- | --- | --- | --- | --- | --- |
| Phase A-0 (準備) | フラグ既定値レビュー、Collector 手動起動手順 | `pnpm tsx scripts/monitor/collect-metrics.ts --dry-run` の検証、`docs/CONFIG_FLAGS.md` 差分レビュー | Diff Merge UI（`merge.precision=legacy` で非露出） | Dev Lead / SRE | `docs/IMPLEMENTATION-PLAN.md` §2.1.1, §2.1.3 |
| Phase A-1 (QA Canary) | AutoSave 保存経路、Collector→Analyzer JSONL 連携 | QA テレメトリの 15 分 ETL、Slack `autosave-warn` テンプレ動作確認 | 一般ユーザー通知（QA 専用チャネルで代替） | QA / Analyzer 担当 | `docs/design/autosave-merge-monitoring.md` §2, §5 |
| Phase A-2 (β導入) | AutoSave + ロールバック Runbook、Reporter OK/Warn 通知 | `pnpm run flags:rollback --phase a1` のドライラン、PagerDuty AutoSave サービス接続確認 | Merge Diff UI 検証（Phase B 以降で実施） | Release Ops / Reporter 担当 | `docs/IMPLEMENTATION-PLAN.md` §2.1.2 |
| Phase B-0 (Merge β) | Diff Merge UI、Analyzer マージ成功率算出 | `merge_auto_success_rate` 閾値試験、`autosave-incident` 通知テンプレ | 全量展開（Phase B-1 で実施） | Merge PM / Analyzer 担当 | `docs/design/autosave-merge-rollout.md` §0.2 |
| Phase B-1 (GA) | 全ユーザー通知、ガバナンス承認、RCA アーカイブ | 72h 連続 SLO 確認、`reports/rca/<date>.md` 作成、`templates/alerts/rollback.md` 添付 | Canary 限定計測（前フェーズで完了済み） | Governance 委員会 / Reporter | `governance/policy.yaml` ロールアウト章 |

## 2. フェーズ以外の管理観点

- **非対象例**: インフラ系メトリクス（例: CDN キャッシュヒット率）は AutoSave/精緻マージロールアウトの直接管理対象外とし、SRE プラットフォームチームの既存運用に委任する。
- **テンプレート利用手順**: 新規フェーズを追加する場合、上表の列を踏襲し、Collector/Analyzer/Reporter の責務が Day8 アーキテクチャ図と齟齬しないことを確認する。【F:Day8/docs/day8/design/03_architecture.md†L1-L36】
- **レビュー観点**: 管理対象アクティビティが `docs/CHECKLIST.md` と重複する場合はチェックリスト ID を列挙し、ロールバック手順が最新 Runbook に一致するかをレビューログで証跡化する。
