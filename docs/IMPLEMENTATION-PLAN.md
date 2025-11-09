# Implementation Plan: Integration Verification

- 目的: リポジトリの既存ルール（型: mypy/strict, Lint: ruff, テスト: pytest / node:test, ESM/TS 方針, 例外ポリシー）を自動検出し、厳密遵守する統合検証プロセスを実装する。変更は最小差分（Public API 破壊禁止）とし、不可避な場合のみ TASKS に追記タスクとチェックリストを追加する。
- 背景: DAY8 の TASK.codex.md / TASK.sample.md、および docs/IMPLEMENTATION-PLAN.md と docs/design/app-merge-dock-integration.md の観点を反映。参照ドキュメントを検証計画に組み込む。

## 受け入れ基準
- 既存のLint、型チェック、テストコマンドが自動検出され、実行されること。
- 変更が最小差分に留まり、Public APIを破壊しないこと。
- docs/IMPLEMENTATION-PLAN.md および docs/design/app-merge-dock-integration.md の観点が検証プロセスに組み込まれていること。
- 実装はテスト駆動開発を優先し、適切なテストが先行して実装されること。

## 実装計画
1) 既存のLint、型チェック、テストコマンドを自動検出するスクリプト/設定を調査・作成する。
2) 統合検証の実行フローを定義する。
3) docs/IMPLEMENTATION-PLAN.md および docs/design/app-merge-dock-integration.md の内容を検証プロセスに組み込む具体的なステップを設計する。
4) テスト駆動開発の原則に従い、検証スクリプトのテストを先に実装する。
5) 検証スクリプト本体を実装する。

## テスト計画
- 単体テスト: 自動検出ロジックのテスト、検証フローの各ステップのテスト。
- 統合テスト: 実際のプロジェクトで検証スクリプトを実行し、報告結果を検証。

## レビューと品質基準
- コードスタイルとLintの遵守
- 型安全性の確保
- API の後方互換性
- エラーハンドリングの適切性
- パフォーマンス影響の最小化
- セキュリティ配慮
- ドキュメント更新（必要時）

## ゲートコマンド
- npm run lint
- npm run typecheck
- npm test
- npm run build

## 参照ドキュメント
- Day8/workflow-cookbook/TASK.codex.md
- Day8/workflow-cookbook/examples/TASK.sample.md
- docs/IMPLEMENTATION-PLAN.md
- docs/design/app-merge-dock-integration.md
