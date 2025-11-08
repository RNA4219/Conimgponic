# Diff Merge テスト計画 (雛形 - TDDベース)

## 目的
Diff Merge機能の正確性と安定性を検証するケース定義と実施手順を記述する。

## 背景
- 既存のテスト計画に基づく拡張
- タスク間のI/O契約とスナップショット整合性を主眼

## ケース一覧（雛形）
- MD-U-01: legacyモードの挙動検証
- MD-U-02: betaモードのDiff Merge挙動検証
- MD-U-03: stableモードのパラメータ検証
- MD-I-01: 既存シーケンス保持

## 実施手順
- 前提条件の確認
- テストケースの実装順序
- CI実行

## CI コマンド
- pnpm lint
- pnpm typecheck
- pnpm test --filter merge
