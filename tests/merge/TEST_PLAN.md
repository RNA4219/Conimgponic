Diff Merge テスト計画

目的
- Diff Merge の精度と安定性を検証する。I/O契約とエッジケースをカバー。

参照ファイル
- tests/TEST_STRATEGY_AUTOSAVE_MERGE.md
- docs/TEST-PLAN.md

範囲
- precision 切替、スナップショット、衝突解決の挙動を検証。

ケース定義
- 基本ケース: 正常に差分を適用。
- 衝突ケース: 衝突時の挙動とエラーメッセージを検証。
- 断絶ケース: 入力が途中で途切れた場合の耐性を評価。

CI/実行手順
- node:test / pytest の実行を想定。
- lint/型チェックの実行を想定。

評価基準
- すべてのテストが green、または適切なエラー検出。
- I/O契約の整合性。

CI コマンド例
- npm install
- npm test
- pytest
- ruff check .
