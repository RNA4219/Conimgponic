
# v1.3 実装計画（AutoSave & 精緻マージ）

## 0) 方針
- 既存スキーマ（`Storyboard`/`Scene`）は**不変**。新規ファイルは OPFS に追加。
- 既存UIの動線は維持。新規は**タブ**/小パネルとして追加。
- フラグで段階導入: `autosave.enabled`、`merge.precision`。

## 1) 対象モジュール追加
- `src/lib/autosave.ts`（API・イベント・ローテ）
- `src/lib/locks.ts`（Web Locks + フォールバック）
- `src/lib/merge.ts`（3-way・スコア・決定化）
- `src/components/AutoSaveIndicator.tsx`（UI/履歴）
- `src/components/DiffMergeView.tsx`（衝突解消UI）
- 既存更新: `MergeDock.tsx`（Diff Mergeタブ追加）, `App.tsx`（AutoSave起動）

## 2) ロールアウト
- **Phase A**: AutoSave（既定OFF→内テスト→既定ON）
- **Phase B**: 精緻マージ（beta→stable）。従来の manual-first/ai-first を残す。

## 3) 工数（概算）
- AutoSave 実装 1.5–2.0 人日 + UI 0.5
- マージエンジン 2.0 人日 + UI 1.0 + ログ統合 0.5
- 試験（両機能） 1.0
**合計: 6.5〜7.0 人日/1名**

## 4) 受入基準（要約）
- AutoSave: 入力停止 ≤2.5s で保存。強制終了→起動で ≤5s 前の復元。
- マージ: ラベル付きケースで自動マージ率 ≥80%、再実行で決定的。
