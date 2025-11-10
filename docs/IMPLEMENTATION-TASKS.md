# 本体実装タスク一覧

このファイルは本体実装フェーズで参照すべき全体方針と、実装時のタスク分解を記述します。引用元として次を参照します：
- docs/IMPLEMENTATION-PLAN.md
- docs/CONFIG_FLAGS.md
- docs/MERGE-DESIGN-IMPL.md
- src/components/MergeDock.tsx

目的
- 変更は最小差分を原則とし、Public API 破壊は避ける。
- テスト駆動開発を優先し、テスト実装を先行させる。
- 収集した要件は実装と検証の両方を一貫してサポートする。

実装方針（フェーズ分け）
1) 仕様整合の確定
   - 参照元: docs/IMPLEMENTATION-PLAN.md, docs/CONFIG_FLAGS.md, docs/MERGE-DESIGN-IMPL.md, src/components/MergeDock.tsx
   - MERGE-DESIGN-IMPL.md の Diff Merge UI/AutoSave のフローと precision 切替仕様に整合させる。

2) テスト設計と雛形作成（先行実装）
   - ユニットテスト雛形を tests/mergeDock.test.ts に追加案
   - AutoSave heartbeat, precision 切替に関するモックを含む skeleton を用意
   - 統合テストの最小ケースを1件追加予定

3) 最小差分実装（MergeDock.tsx への適用）
   - docs/MERGE-DESIGN-IMPL.md の指針に沿って、MergeDock.tsx へ影響範囲の最小差分だけを適用する。
   - 影響範囲: タブ構成、AutoSave ハートビート、precision 切替、フラグ連携

4) 変更リストの作成と検証
   - どのファイル・どの行に変更を加えたかを短く記載
   - lint / type-check / テストの実行計画を更新

5) ドキュメント差分の反映
   - API/CLI 変更時のみ差分ドキュメントを同梱する方針を Docs に追記

進捗管理
- 現在の優先タスク: 仕様整合の確定と雛形テストの準備
- 次のアクション: MergeDock.tsx への差分適用案の具体化と雛形テスト実装

引用
- IMPLEMENTATION-PLAN.md の Phase/Flag運用関連
- CONFIG_FLAGS.md の優先順位とガード設計
- MERGE-DESIGN-IMPL.md の UI/自動保存/精度切替の仕様
- src/components/MergeDock.tsx の現行実装
