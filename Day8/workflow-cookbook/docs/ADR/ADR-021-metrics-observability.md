# ADR-021: メトリクスと可観測性の統合

- 日付: 2025-01-15

- 背景:
  デプロイ後の振り返りで、SLO を示す統一的なメトリクス参照点が不足していたため、
  リリース可否判断やインシデント初動で参照資料が分散してしまった。

- 決定:
  RUNBOOK / EVALUATION / governance/metrics.yaml を統一メトリクスセットで結び、
  `CHECKLISTS.md` の Release 手順でメトリクス最新化と証跡共有を必須化する。
  また、Birdseye マップと Katamari 由来の監視テンプレを同期して、
  可観測性の指標と操作フローを一元管理する運用に移行する。

- 影響範囲:
  - 運用チーム
  - レビューフロー
  - docs/birdseye 配下の依存チャート
  - tools/perf/* モジュールのダッシュボード生成処理

- フォローアップ:
  1. tools/perf/ 配下モジュールのメトリクス収集テンプレを更新すること。
  2. Birdseye のターゲットを定期的に同期する運用フローを確立すること。
  3. Release レビュー時にメトリクス差分チェックを必須化し、運用を定着させること。

## 関連ドキュメント

- [CHECKLISTS.md の Release 手順](../../CHECKLISTS.md#release)
- [RUNBOOK.md の Observability セクション](../../RUNBOOK.md#observability)
- [EVALUATION.md の KPIs セクション](../../EVALUATION.md#kpis)
- [governance/metrics.yaml](../../governance/metrics.yaml)
- [docs/birdseye/index.json](../birdseye/index.json)
