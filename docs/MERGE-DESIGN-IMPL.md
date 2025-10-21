
# 精緻マージ 実装詳細

## 1) 目的
- Base(前版) / Ours(Manual) / Theirs(AI) の3-way決定的マージ
- セクション（ラベル or 段落）単位で類似度により自動採用 or 衝突

## 2) プロファイル
```ts
type MergeProfile = {
  tokenizer: 'char'|'word'|'morpheme',   // 既定: 'char'（日本語安定）
  granularity: 'section'|'line',         // 既定: 'section'
  threshold: number,                      // 既定: 0.75
  prefer: 'manual'|'ai'|'none'            // lock未指定時のデフォ
}
```

## 3) インタフェース
```ts
export type MergeInput = { base: string; ours: string; theirs: string; sections?: string[] }
export type MergeHunk = {
  section: string | null,
  decision: 'auto'|'conflict',
  similarity?: number,
  merged?: string,
  manual?: string,
  ai?: string
}
export function merge3(input: MergeInput, profile?: Partial<MergeProfile>): { hunks: MergeHunk[], mergedText: string, stats: { auto: number, conflicts: number, avgSim: number } }
```

## 4) アルゴリズム
1) セクション分割 → ラベル（`[主語]...`）の行を優先。無ければ空行で段落化  
2) 各セクションで LCS 差分 → 類似度（Jaccard/Cosine簡易）  
3) `similarity ≥ threshold` → **auto**。`lock`/`prefer` を反映  
4) 未満 → **conflict** として両案を保持  
5) 連続autoは連結。出力は決定的（乱数・時刻不使用）

## 5) UI / インタラクション
- `MergeDock` に **Diff Merge** タブ
- セクション：自動採用（薄緑）／衝突（黄色）
- 衝突ごとに「Manual採用」「AI採用」「手動編集」
- 一括操作：しきい値スライダー、全Manual/全AI
- 「結果を採用」→ `Scene.manual` に書き戻し（既存フローと互換）

### 5.1 コンポーネント構成
```
MergeDock (既存タブ群)
└─ DiffMergeView (新規タブ本体)
   ├─ DiffMergeTabs …… MergeDock のタブバーに `Diff Merge`
   ├─ HunkListPane …… 左列。フィルタ/統計 + ハンク概要リスト
   │   ├─ MergeSummaryHeader …… auto/conflict 件数と閾値スライダー
   │   └─ MergeHunkRow[n] …… decision バッジ + section タイトル + ミニ差分
   └─ OperationPane …… 右列。選択中ハンクの詳細
       ├─ BulkActionBar …… 全Manual/全AI/全リセット + 選択操作
       ├─ MergeHunkDetail …… Base/Ours/Theirs 差分ビュー + ステータス
       │   ├─ DiffSplitView …… 左右比較（スクリーンリーダー向けテキスト複製）
       │   ├─ DecisionButtons …… Manual / AI / 編集 / AI再実行
       │   └─ StatusBadge …… 自動採用/衝突/進行中を色＋アイコン表示
       └─ EditModal …… 手動編集フォーム（保存/キャンセル/Undo）
```
レイアウトは左右 2 カラム（`minmax(280px, 35%)` + `auto`）とし、ハンク一覧は仮想スクロールで 100+ 件でも再描画負荷を抑える。

### 5.2 マージハンク状態機械
各ハンクは下記ステートマシンで管理し、UI 表示と `merge.ts` コマンドを同期する。

```
state MergeHunk {
  AutoResolved
  Conflict {
    Idle
    ApplyingManual
    ApplyingAI
    ManualEditing
  }
}
```

- 初期状態は `AutoResolved`（`decision:'auto'`）または `Conflict.Idle`（`decision:'conflict'`）。
- `Conflict.Idle --Manual採用--> AutoResolved` ：`queueMergeCommand({ type:'setManual', hunkId })` を `merge.ts` に送出。
- `Conflict.Idle --AI採用--> AutoResolved` ：`queueMergeCommand({ type:'setAI', hunkId })`。AI テキスト未生成時は `ApplyingAI` に遷移し、`merge.ts` が AI 呼び出し後に `AutoResolved` へ遷移するイベントを publish。
- `Conflict.Idle --手動編集--> Conflict.ManualEditing` ：DiffMergeView で `openEditModal(hunkId)` を dispatch。
- `Conflict.ManualEditing --保存--> AutoResolved` ：`queueMergeCommand({ type:'commitManualEdit', hunkId, text })`。
- `Conflict.ManualEditing --キャンセル--> Conflict.Idle` ：UI のみで state 戻し、副作用なし。
- `AutoResolved --再オープン--> Conflict.Idle` ：「リセット」操作時に `queueMergeCommand({ type:'resetDecision', hunkId })`。
- 一括操作（全Manual/全AI/全リセット）は対象ハンクへ順次コマンドを送出。送信中は `BulkActionBar` が progress 表示し、未完了ハンクを `ApplyingManual/AI` で表現する。

`queueMergeCommand` は `merge.ts` のコマンドキューラッパーで、UI からの要求をストアへ集約した後にバッチ書き戻しする。

### 5.3 書き戻しと履歴整合
- 全コマンドは `Scene.manual` を唯一のソースとし、反映は `merge.ts` → `store.ts` の既存アクション（`commitSceneManual(sceneId, text)`）経由で行う。Undo/Redo は `store.ts` のヒストリースタックに差分パッチを push して担保する。
- `DiffMergeView` は書き戻し完了イベントを購読し、ハンクリストの `merged` 断片を再描画。Undo 実行時は `merge.ts` が逆コマンドを emit（`type:'revertDecision'`）し UI 状態も巻き戻す。
- 書き戻し結果は AutoSave に委譲せず、AutoSave 側のファイル書き込みが完了したときのみ `Saved HH:MM:SS` を更新する（`AUTOSAVE-DESIGN-IMPL.md` に準拠）。
- アクセシビリティ：タブ到達順は `MergeDock` → ハンクリスト → 操作パネル。全ボタンへ `aria-pressed` / `aria-label` 付与。差分ビューは `aria-describedby` でベーステキストを読み上げ可能にし、キーボード操作は `ArrowUp/Down` でハンク選択、`Enter` で決定、`Shift+Enter` で編集開始。

### 5.4 異常系と AutoSave 協調
- マージ統計（`merge.ts` → `stats`）取得失敗時：`MergeSummaryHeader` にエラーバナーを表示し、「再取得」ボタンで `queueMergeCommand({ type:'refreshStats' })` を再送。取得中はスピナー表示。
- 証跡書き込み（`runs/<ts>/merge.json`）失敗時：フッターに `toast` + 詳細ダイアログ。「再試行」選択で `queueMergeCommand({ type:'persistTrace', hunkIds })` を再実行。連続失敗 3 回で `AUTOSAVE` と同様のバックオフ通知。
- AutoSave 連携：`DiffMergeView` の編集開始時に `navigator.locks` で merge セクション専用ロック `imgponic:merge` を獲得。AutoSave 側はロック保持中でも読み込みのみ許可し、書き込みはロック解放後に差分マージを再確認。UI はロック保持中に「保存中…」を抑制し、衝突時は `MergeConflictDialog` を表示して再読込 or 手動差分適用を促す。

### 5.5 TDD ケース・フィクスチャ
React Testing Library で以下をカバーする。
- `DiffMergeView` 初期表示：Auto/Conflict 件数・タブ切り替え・ハンク選択のキーボード操作。
- `DecisionButtons` 操作：Manual/AI ボタン押下で `queueMergeCommand` が正しい payload になる。
- `EditModal` 保存キャンセル：入力内容が `Scene.manual` 書き戻しに伝搬し、キャンセル時はコマンド送出なし。
- 異常系：統計失敗モックでバナー表示 → 再取得クリック時に再試行イベントが発火。
- アクセシビリティ：`aria` 属性、`tab` ナビゲーション順序、スクリーンリーダー用テキストが DOM 上に存在。

Storybook では以下のシナリオを用意。
- `AutoResolved` のみのプロファイル（100 件仮想スクロール）。
- 混在ケース（衝突 + AI再実行中 + 編集モーダル開）
- 異常系（統計取得失敗バナー表示）。

必要フィクスチャ：
- `merge-hunks/basic.json` …… auto/conflict 混在。`Scene.manual`/`ai` モック付き。
- `merge-hunks/all-auto.json` …… 大量 auto 用。
- `merge-hunks/error-stats.json` …… stats API 失敗レスポンス。
- `merge-commands/log.ts` …… `queueMergeCommand` 呼び出し追跡モック。

### 5.6 イベントログ出力チェックリスト
Day8 アーキテクチャの Reporter → Governance 流れに従い、マージ操作で下記ログを残す。

1. `merge:stats:refreshed` — 統計取得成功時。payload: 件数/類似度。
2. `merge:hunk:decision` — Manual/AI/編集確定時。payload: `hunkId`, `decision`, `actor`。
3. `merge:hunk:ai:requested` / `merge:hunk:ai:fulfilled` — AI 再実行の開始/完了。Reporter は AI 成果を草案ログへ追加。
4. `merge:trace:persisted` — 証跡書き込み完了。失敗時は `merge:trace:error` にエラーコード。
5. `merge:autosave:lock` — AutoSave ロック獲得/解放を Governance 監査に通知。
6. すべてのログに `sceneId`, `section`, `ts`, `userId` を含め、Reporter 側の propose-only 原則に従って Git への自動書き込みは行わない。

## 6) 証跡
- `runs/<ts>/merge.json` に hunkごとの `{section, similarity, decision}` を記録
- `meta.json` に `merge_profile` を追記

## 7) 性能目標
- 100カットで ≤5秒（セクションあり、charトークン）
- 必要に応じ **Web Worker** 化（後段）

## 8) 受入
- ラベル付きで自動マージ率 ≥80%
- 再実行で同一結果（決定性）
- lock=manual/ai の優先が反映される
