AutoSave/Diff Merge テスト計画

目的
- AutoSave/Diff Merge 全体のテスト戦略と CI コマンドを網羅する。公開 API には影響を与えず、最小差分で検証を行う。

参照ファイル
- tests/TEST_STRATEGY_AUTOSAVE_MERGE.md
- docs/TEST-PLAN.md

範囲
- AutoSave の diff 検出と適用、Diff Merge の挙動、エッジケースを中心に検証。CI での実行を想定。

ケース定義
- 基本ケース: AutoSave が差分を正しく検出して適用される。
- 衝突ケース: Diff Merge が衝突を検知して適切なエラーメッセージを返す。
- 回帰ケース: 変更前後の差分が安定して適用されることを確認。

CI/実行手順
- npm test または node:test に準拠した実行コマンドを準備。
- lint/型チェックの実行を想定。

評価基準
- すべてのテストが green、または衝突ケースが正しく検出されること。
- 公開 API 破壊がないこと。

CI コマンド例
- npm install
- npm test
- ruff check .  (必要に応じて) 
