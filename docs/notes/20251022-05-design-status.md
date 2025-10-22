# 2025-10-22 設計レビュー（AutoSave / 精緻マージ）

## 概況
- フィーチャーフラグの解像度が `docs/IMPLEMENTATION-PLAN.md` §0 で UI・設定経路まで具体化されており、`src/config/flags.ts` 新設で env → localStorage → 既定値の優先度が確定済み。既存 UI 後方互換も保持できるため、実装開始に向けたガイドとして十分。 
- AutoSave は `docs/AUTOSAVE-DESIGN-IMPL.md` §0-§3 で責務、保存ポリシー、ロック API、エラー分類まで整理されており、再試行条件や no-op 条件も明示されている。実装に必要なインターフェースと例外方針は欠落なし。
- 精緻マージ UI/アルゴリズムは `docs/MERGE-DESIGN-IMPL.md` §4-§5 で Diff タブ導線、しきい値、Collector 連携まで仕様が収束。`historyBoost` など AutoSave 依存もドキュメント相互参照で解決済み。
- テレメトリ連携とロールアウト観測は Day8 アーキテクチャ図で Collector→Analyzer→Reporter までの経路が描かれており、SLO 監視要件（`merge_auto_success_rate`）も同ドキュメントと実装計画で一致。

## 着手前確認事項
- Flags 実装では Phase A のローカルストレージフェールセーフ（既存 UI）が残る想定。`resolveFlags()` に収まらない直読パスは Phase B 以降に削除する計画のため、実装時は現行互換チェックを追加するタスク化が必要。
- AutoSave と Merge の相互依存（履歴ベースの `historyBoost`）は整合が取れているが、テレメトリでの履歴不足ケースを Analyzer がどう扱うかは別途テストケースで補足すると良い。

## 実装GO判断
- 主要コンポーネント（`autosave.ts`, `locks.ts`, `merge.ts`, `DiffMergeView.tsx`）の責務と API が仕様書上で固定されており、後方互換や例外ハンドリングの方針も明文化されているため、実装着手可能と判断。
