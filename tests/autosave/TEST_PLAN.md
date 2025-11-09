# AutoSave テスト計画 (雛形 - TDDベース)

## 目的
AutoSave機能の安定性を検証するためのケース定義と実施手順を記述する。

## 背景
- 既存のテスト計画に基づく拡張
- autosaveの状態遷移とデータ整合性を主眼

## ケース一覧（雛形）
- AS-U-01: AutoSave Off時の手動保存が正しく機能する
- AS-U-02: AutoSave On時の自動保存間隔でのデータ保存
- AS-U-03: localStorage上書き優先
- AS-I-01: 復元/リカバリのパス

## 実施手順
- 前提条件の確認
- テストケースの実装順序
- CI実行

## CI コマンド
- pnpm lint
- pnpm typecheck
- pnpm test --filter autosave
