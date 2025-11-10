# 本体実装タスク一覧

参照・引用ファイル
- IMPLEMENTATION PLAN: docs/IMPLEMENTATION-PLAN.md
- 設定・配布方針: docs/CONFIG_FLAGS.md
- MERGE 関連設計: docs/MERGE-DESIGN-IMPL.md
- 現行実装: src/components/MergeDock.tsx

概要
本体実装フェーズのタスクを、上記参照ファイルを引用して整理します。変更は最小差分・公開API破壊禁止を原則とし、テスト駆動開発を前提とします。

タスク一覧
1) 設計方針の整理と差分方針の確定
   - 引用元: docs/IMPLEMENTATION-PLAN.md, docs/CONFIG_FLAGS.md
   - 目的: AutoSave と精緻マージの段階導入フローの整備、有効なフラグ運用の定義

2) テスト戦略の設計と雛形作成
   - 引用元: MERGE-DESIGN-IMPL.md の UI/ロック協調・AutoSave連携要件を踏まえる
   - 目的: MergeDock の AutoSave ハートビート、precision 切替、フラグ連携を検証するテスト案の作成

3) 実装設計
   - 引用元: src/components/MergeDock.tsx
   - 目的: 差分実装方針を策定（AutoSave heartbeat、precision切替、フラグ適用の実装方針）

4) テスト実装
   - 引用元: 上記設計
   - 目的: ユニット/統合テストの雛形を実装、テストコードを追加

5) 品質保証
   - 引用元: リポジトリの静的検査基準（ruff/mypy 等）と既存のテスト流儀
   - 目的: static checks とテスト実行手順を整備、CIと整合

6) ドキュメント反映
   - 引用元: docs/CONFIG_FLAGS.md, docs/MERGE-DESIGN-IMPL.md の更新案
   - 目的: 実装変更を反映したガイドライン更新

7) 変更差分のコミット計画
   - 目的: 小さな差分での複数コミットを想定し、適切なコミットメッセージを準備

進行ロジック
- 最初に絶対パスを頂いた後、上記ドラフトを実ファイルとして作成・保存します。
- 実装は PLAN に基づき、最小差分・非破壊を徹底します。
