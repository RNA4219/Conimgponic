# Birdeye チェックリスト

Birdeye ダッシュボードでタスク実装の進捗を確認するためのチェックリスト。以下の項目を順に実施し、完了時に Birdeye で閲覧・検証可能な状態にします。

## 参照元
- IMPLEMENTATION-PLAN.md
- AUTOSAVE-DESIGN-IMPL.md
- 実装対象ファイル: src/lib/autosave.ts, src/platform/vscode/autosave.ts

## 実装方針の適用
- 公開APIの破壊を避け、最小差分での変更を心がける
- テスト駆動開発を基本とし、テストを先に作成する
- リポジトリのルール（型検査、Lint、テスト等）を自動検出して遵守する

## チェックリスト
- [x] IMPLEMENTATION-PLAN.md と AUTOSAVE-DESIGN-IMPL.md を読み、要件を把握する
- [ ] AutoSave の例外設計・再試行戦略を src/lib/autosave.ts に実装する計画を確認
- [ ] VSCode ブリッジ用 autosave.ts の状態遷移・テレメトリ設計を確認
- [ ] 単体テスト/統合テストの追加計画を作成
- [ ] 最小差分で変更を適用できるよう、公開 API 破壊がないことを確認
- [ ] Lint/Typeチェック/テストを実行してグリーンを確認
- [ ] 変更内容をドキュメントに反映
- [ ] Birdeye のダッシュボードに反映されたことを確認
- [ ] 実装サマリを日本語で報告

## 記録・運用
- ブランチ名・コミットメッセージは「何をなぜ変更したか」を中心に記録する
- 差分は最小化、必要時のみファイル分割を検討
