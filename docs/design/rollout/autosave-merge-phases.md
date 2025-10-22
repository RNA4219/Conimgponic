# AutoSave & 精緻マージ ロールアウト管理テンプレート

本テンプレートは AutoSave (`autosave.enabled`) および 精緻マージ (`merge.precision`) のロールアウトフェーズを統合管理するための定義集である。各フェーズで Collector/Analyzer/Reporter が監視・通知対象とする要素と、運用統制の対象外（観測のみ）とする要素を明示する。

## 1. フェーズ管理対象一覧

| フェーズ | 管理対象フラグ | Collector 収集指標 | Analyzer 判定項目 | Reporter 通知チャネル |
| --- | --- | --- | --- | --- |
| Phase A-0 (準備) | `autosave.enabled` | `autosave_p95`, `autosave_error_count` | ロールバック閾値未設定（準備レビューのみ） | Slack `#launch-autosave` 準備メモ |
| Phase A-1 (QA Canary) | `autosave.enabled` | `autosave_p95`, `restore_success_rate` | `autosave_p95`≤2.5s、`restore_success_rate`≥99.5% | Slack `#launch-autosave`、重大時 PagerDuty AutoSave |
| Phase A-2 (β導入) | `autosave.enabled` | `restore_success_rate`, `autosave_incident_rate` | `restore_success_rate`≥99.5%、クラッシュ率差分 | Slack `#launch-autosave`、PagerDuty AutoSave (P2) |
| Phase B-0 (Merge β) | `merge.precision` | `merge_auto_success_rate`, `merge_conflict_rate` | `merge_auto_success_rate`≥80% | Slack `#merge-ops`、PagerDuty Merge |
| Phase B-1 (GA) | `autosave.enabled`, `merge.precision` | 全 AutoSave/Merge SLO 指標 | SLO 連続達成 5 日、重大事故未発生 | PagerDuty Incident-001、Slack `#incident` |

## 2. フェーズ管理非対象（モニタリングのみ）

| 項目 | 理由 | 監視タイミング | 担当 |
| --- | --- | --- | --- |
| `merge.precision`=`legacy` 時の Diff タブ UI | Phase B-0 以前は露出しないため運用判断対象外 | Phase A-0〜A-2 | プロダクトチーム（QA レポート共有） |
| `autosave.enabled` Canary 外ユーザーの保存成否 | 標準ユーザーにはフラグ未展開 | Phase A-1 | Collector (ログ保持のみ) |
| `merge.precision` ステージング環境 | 本番ロールアウト前のテストであり、SLO レビュー対象外 | Phase B-0 | Analyzer (結果レビュー共有のみ) |
| Runbook `flags:rollback` ドライラン結果 | 手順確認のための演習であり、実ロールバック判定から除外 | 全フェーズ | Reporter (演習記録を docs/rehearsal/ へ保管) |

> **備考**: 非対象項目も JSONL には記録するが、Analyzer による SLO 判定には含めない。Collector はタグ `observed_only=true` を付与し、Reporter は日次サマリに脚注として掲載する。

## 3. 運用メモ
- 各フェーズ遷移前に本テンプレートを更新し、レビュー議事録にリンクする。
- 監視対象の変更は `docs/CONFIG_FLAGS.md` および `governance/policy.yaml` の更新と同一コミットで行う。
- Day8 パイプラインの ETL 15 分サイクルと整合するよう、Collector/Analyzer/Reporter の担当窓口を再確認する。
