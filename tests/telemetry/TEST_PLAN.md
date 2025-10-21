# Telemetry 整合性テスト計画

AutoSave/Diff Merge のイベントスキーマと Collector/Analyzer/Reporter 連携を TDD で検証する。`Day8/docs/day8/design/03_architecture.md` に基づき、JSONL 収集からレポート生成までの整合性を保証する。【F:Day8/docs/day8/design/03_architecture.md†L1-L31】

## 1. テストスコープ
- 対象イベント: `autosave.save.completed`, `autosave.restore.result`, `merge.diff.apply`, `autosave.lock.error`, `autosave.slo.violation`。【F:docs/design/autosave-merge-rollout.md†L45-L134】
- システム境界: `Collector` (JSONL ingest) → `Analyzer` (メトリクス算出) → `Reporter` (サマリ生成)。【F:Day8/docs/day8/design/03_architecture.md†L1-L31】
- 前提フラグ: Phase A/B の既定値とロールバック条件を実装計画に従って設定する。【F:docs/IMPLEMENTATION-PLAN.md†L52-L75】

## 2. テストケース
| ID | 観点 | 手順 | 期待結果 |
| --- | --- | --- | --- |
| T1 | 保存遅延 | `autosave.save.completed` のダミー JSONL を投入し、Analyzer が保存時間 P95 を算出できるか検証 | P95 が 2.5s 以内なら PASS、超過時は SLO 違反イベントが生成される。【F:docs/IMPLEMENTATION-PLAN.md†L52-L60】 |
| T2 | 復旧成功率 | 復旧成功/失敗を混在させた JSONL を Analyzer に供給 | 復旧成功率が 99.5% 未満で `autosave.slo.violation` が記録される。【F:docs/IMPLEMENTATION-PLAN.md†L52-L69】 |
| T3 | 自動マージ率 | `merge.diff.apply` を投入し、`auto_accept_ratio` 集計を検証 | Ratio<0.8 でロールバック条件が発火する。【F:docs/IMPLEMENTATION-PLAN.md†L58-L67】 |
| T4 | ロック再試行 | `autosave.lock.error` を複数回発火させ、`retryable` が true のケースを再現 | Analyzer が再試行回数を集計し、Reporter に再試行負荷を記録。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L120-L146】 |
| T5 | SLO 通知経路 | SLO 違反イベントを Collector に送信 | Slack/GitHub 通知のモックが呼ばれ、Reporter にロールバック手順が記録される。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L96-L111】【F:docs/design/autosave-merge-rollout.md†L142-L167】 |

## 3. 実装方針
1. `tests/fixtures/telemetry/` に JSONL サンプルを追加し、Collector モック経由で読み込む。
2. Analyzer 用のユーティリティをモックし、P95 や成功率計算が仕様に沿うことを検証する。
3. Reporter にはロールバック通知テンプレートの挿入を確認するスナップショットテストを適用する。
4. 失敗時は `retryable` 判定に基づく指数バックオフが `docs/AUTOSAVE-DESIGN-IMPL.md` の設計通りであることを assertion する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L120-L146】

## 4. 評価基準
- 各テストは Phase ごとのフラグ状態を明示し、閾値の境界ケースをカバーする。
- JSONL スキーマ変更は PR 時にテストを更新し、後方互換性をレビューで確認する。
- Reporter 出力が `templates/alerts/rollback.md` と矛盾しないことをレビューで検証する。【F:docs/IMPLEMENTATION-PLAN.md†L86-L95】
