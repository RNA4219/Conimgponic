# Task Seed: AutoSave/精緻マージ ロールアウト監視フォローアップ

## 背景
AutoSave/精緻マージの段階導入において、Collector→Analyzer→Reporter の監視経路とロールバック手順が新設された。運用で検知したギャップを埋めるためのフォローアップタスクを作成する際、本テンプレートを使用する。

## タスク雛形
- **タイトル**: `[Rollout][Phase-<A/B>] <問題の概要>`
- **説明**:
  1. 現象（SLO 逸脱指標、対象フェーズ、発生バッチ ID）
  2. 暫定対応（Collector/Analyzer/Reporter のどこで対処したか）
  3. 恒久対応案（再試行ポリシー調整、フラグ運用変更など）
  4. 影響範囲（`docs/AUTOSAVE-DESIGN-IMPL.md` と `Day8/docs/day8/design/03_architecture.md` の参照セクション）
- **完了条件**:
  - `reports/metrics/<phase>/` に改善後の SLO が記録されている。
  - `reports/daily/rollout-<date>.md` にフォローアップ完了報告を追記。
  - `templates/alerts/rollout-monitor.md` に必要な改修が反映。

## 参考リンク
- 監視設計: `reports/rollout-monitoring-design.md`
- チェックリスト: `reports/rollout-monitoring-checklist.md`
- 運用 Runbook: `scripts/monitor/README.md`

## 進行管理メモ欄
- [ ] 分析完了（担当: QA）
- [ ] 恒久対応案レビュー完了（担当: Feature Team）
- [ ] 実装完了（担当: Dev）
- [ ] 監視シナリオ更新完了（担当: Release Eng.）
