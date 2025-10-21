# DiffMerge UI 設計概要

## 背景と目的
- `merge.precision` フラグで差分マージ機能を段階解放する。
- 既存のマニュアル/AI選択体験を維持しつつ、Diff Mergeビューの責務とタブ統合を整理する。

## UI 構成図
```
MergeDock
└─ Tabs: Compiled | Shotlist | Assets | Import | Golden | (Diff Merge)
      └─ Diff Merge (flag:on)
         ├─ DiffMergeView
         │   ├─ Header
         │   │   ├─ scene selector (dropdown)
         │   │   └─ view mode toggle [Auto result | Manual input | AI draft]
         │   ├─ ThreePaneDiff
         │   │   ├─ base: original
         │   │   ├─ left: manual (editable)
         │   │   └─ right: ai (readonly)
         │   └─ MergeActions footer (apply / revert / copy)
         └─ MergeStatusSidebar
             ├─ MergeProfile summary
             └─ MergeHunk list (jump links)
```

## コンポーネント責務
### DiffMergeView.tsx
- `merge.precision` が true のときのみマウントされ、scene毎の差分統合に特化。
- `ThreePaneDiff` と `MergeStatusSidebar` を編成し、表示状態・イベント配信のハブとなる。
- 入力props:
  - `sceneId: string` 選択シーンID。
  - `scenes: MergeScene[]` コンパイル対象シーン配列。
  - `profile: MergeProfile | null` diff計算済みメタ情報。
  - `hunks: MergeHunk[]` 連携済み差分パッチ。
  - `onSelectScene(id: string): void` シーン切替イベント。
  - `onApply(profileId: string, hunkIds?: string[]): void` 差分適用通知。
  - `onReset(sceneId: string, target: 'manual' | 'ai' | 'auto'): void` 状態復旧。
  - `onCopy(sceneId: string, source: 'manual' | 'ai' | 'merged'): void` クリップボード転送要求。
  - `mergePrecision: 'off' | 'on' | 'strict'` UI表示条件制御。
- 内部stateは表示モード (`'merged'|'manual'|'ai'`) とハイライト対象のみ保持。

### MergeDock.tsx
- 既存タブ配列に `Diff Merge` を追加。
- `merge.precision` が `'off'` の場合はタブを非表示、 `'on'|'strict'` の場合のみ解放。
- 既存 `pref` セレクタの `'diff-merge'` 選択時もタブが無効なら警告トーストを出す。
- `DiffMergeView` を遅延ロードし、propsを `merge3` ランタイム結果から構成。

### src/lib/merge.ts
- `computeMergeProfile(scenes: Scene[]): MergeProfile` を公開し、`MergeHunk` 配列と `profileId` を生成。
- `applyHunks(scene: Scene, hunks: MergeHunk[], strategy: 'manual'|'ai'|'auto'): Scene` で部分適用を仲介。
- `merge.precision` を参照し、非対応時は既存マージロジックを返す後方互換 API を維持。

## Props / イベント仕様
| Prop / Event | 型 | 発火タイミング | 備考 |
| --- | --- | --- | --- |
| `sceneId` | `string` | MergeDockから選択変更時 | URLクエリ同期を想定 |
| `scenes` | `MergeScene[]` | Dock初期化・再計算時 | `manual`/`ai`/`lock` を含む |
| `profile` | `MergeProfile \| null` | diff未計算時は null | `profileId`, `summary` を持つ |
| `hunks` | `MergeHunk[]` | `computeMergeProfile` 完了時 | 行毎のdiffメタ情報 |
| `onSelectScene` | `(id: string) => void` | シーン切替UI操作 | Dock側でstate反映 |
| `onApply` | `(profileId: string, hunkIds?: string[]) => void` | マージ確定操作 | `hunkIds` 未指定は全適用 |
| `onReset` | `(sceneId: string, target: 'manual'|'ai'|'auto') => void` | リセットボタン押下 | 既存lock挙動と合わせる |
| `onCopy` | `(sceneId: string, source: 'manual'|'ai'|'merged') => void` | コピー操作 | クリップボード実装はDock側 |
| `mergePrecision` | `'off'|'on'|'strict'` | 設定変更時 | `'strict'` でDiff Mergeタブをデフォルト選択 |

## 後方互換制御
- `merge.precision==='off'` 時: MergeDockのタブ構成・prefロジックは現行通り、DiffMergeViewはレンダリングしない。
- `merge.precision!=='off'` 時: タブ追加、`pref==='diff-merge'` の場合に Diff Merge タブへフォーカス。
- `merge.precision==='strict'` 時: Compiledタブのpref初期値を `'diff-merge'` に設定し、DiffMergeViewタブを先頭表示。

## テスト観点表
| 観点ID | シナリオ | 期待結果 |
| --- | --- | --- |
| T1 | `merge.precision='off'` で起動 | Diff Mergeタブ非表示、既存pref動作不変 |
| T2 | `merge.precision='on'` で起動しDiffタブ選択 | `DiffMergeView` が `scenes`,`profile`,`hunks` を受け取り表示 |
| T3 | Diffタブで `onApply` 実行 | MergeDockがハンドラを受信し `applyHunks` を呼ぶ |
| T4 | Diffタブで `onReset('manual')` | 対象シーンのmanualテキストが初期化 |
| T5 | `merge.precision='strict'` で起動 | Diff Mergeタブがデフォルト選択、Compiledタブprefは `diff-merge` |
| T6 | `computeMergeProfile` 失敗時 | DiffMergeViewにエラーバナー表示、既存タブへフォールバック |
| T7 | ハイライト行選択 → `MergeStatusSidebar` | 対応hunkがスクロールフォーカスされる |
