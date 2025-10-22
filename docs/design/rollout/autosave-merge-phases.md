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
