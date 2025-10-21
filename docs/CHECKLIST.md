
# リネーム作業チェックリスト
- [ ] ローカルで作業ブランチ `rename/conimgponic` を作成
- [ ] `scripts/rename.mjs` を実行（プロジェクトルート指定）
- [ ] 変更差分をレビュー（package.json, index.html, manifest, README, App.tsx）
- [ ] PWAを再ビルドし、端末で**再インストール**して表示名を確認
- [ ] 既存データ（OPFS/LocalStorage）が読み込めることを確認
- [ ] CHANGELOG に改名を明記（v1.4.1）
- [ ] GitHubリポジトリ名/説明/Topicsを更新（必要なら）

## テレメトリ QA チェックリスト
- [ ] `pnpm tsx scripts/monitor/collect-metrics.ts --window=15m` の実行結果を `reports/monitoring/` に保存し、直近 2h の保存遅延 P95 を検証した。
- [ ] `autosave.restore.result` ログから復旧成功率 ≥ 99.5% を Analyzer が算出し、Runbook に記録した。
- [ ] `merge.diff.apply` 集計結果が自動マージ率 ≥ 80% を満たし、Slack テンプレートによる日次共有を送付した。

## 開発チームチェックリスト
- [ ] フェーズ既定値 (`autosave.enabled`, `merge.precision`) が `docs/design/rollout-plan.md` の表と一致するようフラグ設定を更新した。
- [ ] SLO 違反時の `flags:rollback --phase <prev>` コマンドと Slack テンプレートの連携をステージングで検証した。
- [ ] テレメトリスキーマ変更が Collector/Analyzer/Reporter の責務分担表（`docs/design/rollout-plan.md` セクション 4）と整合する。
