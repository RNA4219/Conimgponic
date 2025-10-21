# Merge Precision フロー設計メモ

## 1. MergeDock / DiffMergeView タブ構成棚卸しと `merge.precision` 分岐
- 既存 `MergeDock` は `Compiled Script` / `Shotlist / Export` / `Assets` / `Import` / `Golden` の5タブを持つ。【F:src/components/MergeDock.tsx†L46-L95】
- `Compiled` タブでは `pref` セレクタ (`manual-first` / `ai-first` / `diff-merge`) を保持し、`Golden` タブで `GoldenCompare` を描画する。`Diff Merge` タブは未実装。
- フラグ別表示フロー案:
  | `merge.precision` | タブ構成 | 既定フォーカス | `pref` 初期値 | 備考 |
  | --- | --- | --- | --- | --- |
  | `legacy` | 現行5タブのみ。`pref==='diff-merge'` 選択時はトースト通知で機能未解放を提示。 | `Compiled` | `manual-first` | 後方互換を保持。 |
  | `beta` | 6番目に `Diff Merge` を追加、タブ順は既存末尾。初期フォーカスは `Compiled` のまま。 | `Compiled` | 既存選択値を保持（初回は `manual-first`）。 | DiffMergeView は遅延ロードし、計算中はスケルトン表示。 |
  | `stable` | `Diff Merge` を先頭へ移動し、初期フォーカスを `Diff Merge` に変更。 | `Diff Merge` | `diff-merge` | `Compiled` タブにも DiffMerge の統合結果をサマリ表示。 |
- `DiffMergeView` 内部は `MergeDock` から `mergePrecision` を受け取り、`legacy` の場合は早期 return。`beta/stable` 時のみハンク一覧・サイドバーを表示する。初期タブ表示に合わせ、`mergePrecision` 変更時は `useEffect` でタブ状態を同期する。 

## 2. `src/lib/merge.ts` (`merge3`) API 契約整理
- 想定入力:
  ```ts
  interface MergeInput {
    storyboardId: string;
    sceneId: string;
    base: string; // 現在保存済み本文
    manual: string; // ユーザ編集版
    ai: string; // AI 提案版
    metadata?: { lock?: 'manual' | 'ai'; tokens?: number };
  }
  interface MergeProfileParams {
    precision: 'legacy' | 'beta' | 'stable';
    diffAlgorithm?: 'patience' | 'myers';
  }
  ```
- 主要出力:
  ```ts
  interface MergeProfile {
    profileId: string;
    precision: 'legacy' | 'beta' | 'stable';
    stats: { autoMerged: number; manualPending: number; conflicts: number };
    generatedAt: string; // ISO8601
  }
  interface MergeHunk {
    hunkId: string;
    sceneId: string;
    baseRange: [number, number];
    manualRange: [number, number];
    aiRange: [number, number];
    status: 'auto' | 'conflict' | 'manual-only' | 'ai-only';
    resolution: 'auto' | 'manual' | 'ai' | 'pending';
    preview: { auto: string; manual: string; ai: string };
  }
  interface MergeResult {
    profile: MergeProfile;
    hunks: MergeHunk[];
    merged: string;
    summary: string;
  }
  ```
- 例外ポリシー（`MergeError`）:
  | code | retryable | 主因 | UI 対応 |
  | --- | --- | --- | --- |
  | `feature-disabled` | false | `precision==='legacy'` で `merge3` が要求された | Diff Merge タブを閉じ、既存 pref ロジックへフォールバック |
  | `invalid-input` | false | scene 取得失敗 / 空文字 | バナーでエラー提示、Collector へ `merge.invalid_input` 送信 |
  | `diff-failed` | true | diff ライブラリが例外 | 再試行ボタン表示、Collector へ再試行記録 |
  | `apply-failed` | true | `applyHunks` 実行中の I/O 問題 | UI でリトライ誘導、AutoSave に保存抑制通知 |
- シナリオ別契約:
  | シナリオ | 入力 | 出力 | エラー処理 |
  | --- | --- | --- | --- |
  | Dock 初期表示 (`beta/stable`) | 全シーンの `MergeInput[]` | `MergeResult` 配列（sceneId 紐付け） | `feature-disabled` → Diff タブ非表示 |
  | ハンク適用 | `merge3` 結果 + `hunkIds` | `merged` 更新文字列 | `apply-failed` → Undo イベント発火 |
  | プレビュー再計算 | `precision` 変更 | 新 `MergeProfile` + 再採点 `stats` | `diff-failed` → リトライダイアログ |
  | `legacy` フォールバック | `precision='legacy'` | `merged` = `manual-first` ロジック | `feature-disabled` を `false` にせずログのみ |

## 3. AutoSave / Collector 連携副作用メモ
- AutoSave との調整: DiffMergeView で編集開始時に `navigator.locks` で `imgponic:merge` を取得し、AutoSave へ「差分編集中」イベント (`autosave.lock.merge.editing`) を emit。AutoSave はロック中 `phase='awaiting-lock'` へ遷移せず待機し、解除時に再スケジュールする。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L8-L120】
- Collector 連携: `merge3` 実行結果を `Collector` へ JSONL (`feature='merge'`) で送出。フィールド例: `{ event:'merge.result', profileId, precision, stats, retryable }`。AutoSave エラーとの二重送信を避け、`apply-failed` 時は `autosave.lock.merge.retry` を合わせて記録する。【F:docs/IMPLEMENTATION-PLAN.md†L213-L235】
- イベント駆動設計:
  1. DiffMergeView が `queueMergeCommand` 相当のイベントバスに `type:'startEditing'` を publish。
  2. `src/lib/autosave.ts` が購読し、ロック獲得済みなら継続、未獲得なら `phase='awaiting-lock'` を維持。
  3. `merge3` 完了時に `type:'mergeCompleted'`（payload: `profileId`, `stats`）を publish。Collector はこのイベントを AutoSave とは独立に JSONL へ蓄積する。
  4. エラー発生時 (`MergeError`) は `type:'mergeError'` を publish し、`retryable` に応じて DiffMergeView がリトライ UI or 警告表示を決定。
- ログ/メトリクス: `feature='merge'` のイベントは Collector の ETL が 15 分間隔で集計する。AutoSave との整合のため、`profileId` を共通キーにして保存時間とマージ結果を突合可能にする。【F:docs/IMPLEMENTATION-PLAN.md†L200-L235】
