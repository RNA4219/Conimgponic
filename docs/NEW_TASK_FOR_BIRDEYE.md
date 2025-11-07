# 新規タスク: Birdeye 連携更新

この MD ファイルは、Birdeye への新規追加を実装するためのタスク仕様を記述します。

## 目的
- 新規タスクの導入と Birdeye への追加更新を安全かつ最小差分で実装する。
- 実装前提、設計ガイド、テスト方針を明示する。

## 参照
- docs/IMPLEMENTATION-PLAN.md
- docs/CONFIG_FLAGS.md
- docs/MERGE-DESIGN-IMPL.md
- src/components/MergeDock.tsx

## 内容概要
- 本件の対象タスク: Diff Merge 機能の拡張と Birdeye同期を含む。
- 実装方針: 後方互換性を保ちつつ最小差分を適用。テストは先行して実装。
- テスト方針:
  - 単体テスト: Birdeye更新処理のペイロード生成と dry-run の挙動を検証
  - 統合テスト: MD からのパースと Birdeye 連携のフローを検証（dry-run 含む）

## 変更履歴 / 対象ファイル
- 新規追加: docs/NEW_TASK_FOR_BIRDEYE.md
- 実装候補ファイル: tools/birdeye_sync.js, test/birdeye_sync.test.js
