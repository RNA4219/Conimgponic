# DiffMergeView Component Design

## 1. Scope & Context
- **対象**: `src/components/DiffMergeView.tsx` とそのサブ構成要素（`DiffMergeTabs`, `HunkListPane`, `OperationPane`, 編集モーダル群）。
- **参照仕様**: AutoSave の保存ポリシーとロック運用【docs/AUTOSAVE-DESIGN-IMPL.md】、Day8 パイプラインの Collector→Analyzer→Reporter 連携【Day8/docs/day8/design/03_architecture.md】。
- **目的**: `merge.precision` フラグ (`legacy`/`beta`/`stable`) に応じたタブ露出制御と、ハンク操作の状態管理・`queueMergeCommand` 連携を統合する。
- **非対象**: 実際のマージアルゴリズム（`src/lib/merge.ts`）。

## 2. UI 設計図
### 2.1 タブ構成（MergeDock 配下）
| precision | タブ配列 (`DiffMergeTabs`) | 初期選択 | 備考 |
| --- | --- | --- | --- |
| `legacy` | `Compiled / Shotlist / Assets / Import / Golden` | `Compiled` | Diff Merge はプレースホルダー。既存 5 タブを `DiffMergeTabs` でそのまま描画し、`DiffMergeView` 本体は `null` を返却。 |
| `beta` | `Compiled / Diff Merge / Shotlist / Assets / Import / Golden` | `Compiled` | Diff Merge は QA 用追加タブ。`pref='diff-merge'` 選択で遷移。 |
| `stable` | `Diff Merge / Compiled / Shotlist / Assets / Import / Golden` | `Diff Merge` | Diff Merge を既定表示へ昇格。Compiled は後方互換タブとして残す。 |

### 2.2 タブ遷移図
```mermaid
stateDiagram-v2
    [*] --> Legacy: precision=legacy
    [*] --> Beta: precision=beta
    [*] --> Stable: precision=stable

    Legacy --> Compiled: 初期表示
    Compiled --> Shotlist
    Compiled --> Assets
    Compiled --> Import
    Compiled --> Golden

    Beta --> Compiled: 初期表示
    Compiled --> DiffMerge: Diff Merge タブ押下
    DiffMerge --> Compiled: レガシービューへ戻る

    Stable --> DiffMerge: 初期表示
    DiffMerge --> Compiled
    DiffMerge --> Shotlist
    DiffMerge --> Operation: ハンク選択
    Operation --> EditModal
    Operation --> BulkBar
    BulkBar --> Operation
    EditModal --> Operation
```
- `precision` の変更は `useEffect` で `activeTab` を再初期化し、`legacy` へ降格した場合は Diff Merge 関連ステートを破棄する。

### 2.3 レイアウト
```
┌ DiffMergeTabs ──────────────────────────────┐
│ [Diff Merge] [Compiled] [Shotlist] …        │
├─────────────────────────────────────────────┤
│ HunkListPane        │ OperationPane         │
│ ├ StatsHeader       │ ├ HunkHeader          │
│ ├ FilterControls    │ ├ DecisionButtons     │
│ └ HunkVirtualList   │ ├ DiffViewer          │
│                     │ └ BulkBar / Modals    │
└─────────────────────────────────────────────┘
```
- `OperationPane` 内で編集操作が開始された場合はモーダル (`EditModal`, `ApplyDecisionModal`) をポータル描画し、`DiffMergeView` が開閉制御を持つ。

## 3. 状態管理仕様
### 3.1 主要ステート
| キー | 型 | 説明 |
| --- | --- | --- |
| `mergePrecision` | `'legacy' \| 'beta' \| 'stable'` | フラグ変更時にタブ・ハンク状態を同期。`legacy` 時は `DiffMergeView` をアンマウント。 |
| `activeTab` | `'compiled' \| 'diff-merge' \| 'shotlist' \| …` | `DiffMergeTabs` が制御。precision 切替時に再初期化。 |
| `selectedHunkId` | `string \| null` | ハンク選択。`legacy` 降格・ハンク削除時は `null`。 |
| `hunkState` | `Record<string, HunkUIState>` | ハンクごとの UI 状態キャッシュ。`HunkUIState` は下記ステートマシンに従う。 |
| `queue` | `MergeCommandQueue` | `queueMergeCommand` へ送るペンディング操作。OperationPane で enqueue。 |
| `modalState` | `{ type: 'edit' | 'bulk' | null; hunkId?: string }` | モーダル開閉制御。 |
| `autosaveLock` | `'idle' \| 'acquiring' \| 'held'` | AutoSave とのロック同期。ハンク編集時に `'acquiring'` → `'held'`。 |

### 3.2 ハンク操作ステートマシン
```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> ManualPreview: click manual
    Idle --> AIPreview: click ai
    Idle --> BulkQueued: bulk action enqueue

    ManualPreview --> ManualApplying: confirm
    ManualApplying --> Idle: success
    ManualApplying --> Error: queue failure

    AIPreview --> AIApplying: confirm
    AIApplying --> Idle: success
    AIApplying --> Error

    BulkQueued --> BulkApplying: queueMergeCommand flush
    BulkApplying --> Idle: success
    BulkApplying --> Error

    Idle --> ManualEditing: open edit modal
    ManualEditing --> ManualApplying: save manual edit
    ManualEditing --> Idle: cancel

    Error --> Idle: dismiss banner / retry
```
- `queueMergeCommand` への投入は `ManualApplying` / `AIApplying` / `BulkApplying` / `ManualEditing` から発火し、成功時に `merge.ts` からの完了イベントで `Idle` に戻す。
- `queueMergeCommand` 失敗時は `Error` へ遷移し、`retryable` なら再度 `queueMergeCommand` を呼び出す。非 retryable はバナー表示＋ Collector 送信。

### 3.3 `queueMergeCommand` 連携
| Command | 発火元 | Payload | UI リアクション |
| --- | --- | --- | --- |
| `setManual` | ManualApplying | `{ hunkId, source: 'manual', actor }` | ハンク行に `manual` バッジ付与。 |
| `setAI` | AIApplying | `{ hunkId, source: 'ai', actor }` | ハンク行に `ai` バッジ。 |
| `commitManualEdit` | ManualEditing | `{ hunkId, diff }` | モーダル閉鎖、`autosaveLock` 解放。 |
| `queueBulk` | BulkApplying | `{ hunkIds, decision }` | リストを一括更新。 |
| `revertDecision` | Error banner action | `{ hunkId }` | ハンクを `Idle` へ戻し再描画。 |

### 3.4 AutoSave 連携
- 編集開始時 (`ManualEditing` へ遷移) に `navigator.locks` で `imgponic:merge` を取得し、AutoSave の保存シーケンスを一時停止。【docs/AUTOSAVE-DESIGN-IMPL.md】
- ロック解放後に `autosave.lock.released` を受信して `autosaveLock='idle'` へ戻す。保存再開時は Diff Merge 側の更新完了イベントと整合させる。

## 4. Precision 切替時の UI 遷移
1. `merge.precision` 変更検知 (`useEffect`)。
2. `legacy` 遷移: `activeTab` を `compiled` へリセット、`DiffMergeView` をアンマウント、ハンク関連ステートを初期化。
3. `beta` 遷移: `activeTab` を保持。`pref='diff-merge'` が選択されていた場合のみ `diff-merge` タブを表示。`selectedHunkId` は保持。
4. `stable` 遷移: `activeTab` を強制的に `diff-merge` に設定。初回表示で `selectedHunkId` を最初の衝突ハンクに設定し、操作ペインを表示。
5. いずれの遷移でも `DiffMergeTabs` がタブリストを再構成し、`HunkListPane` のスクロール位置は `selectedHunkId` に応じて復元。

## 5. モーダル連携
- `OperationPane` から `openEditModal(hunkId)` を dispatch → `modalState={type:'edit',hunkId}` → `EditModal` をポータル描画。
- `EditModal` 保存時に `queueMergeCommand({ type:'commitManualEdit', ... })` を実行し、成功時に AutoSave ロックを解放。
- Bulk 操作は `modalState={type:'bulk'}` を介して確認ダイアログを表示し、確定で `queueBulk` を発火。
- モーダル閉鎖時はフォーカスを元の決定ボタンへ戻し、アクセシビリティを確保する。

## 6. テストケース（TDD）
| ID | precision | シナリオ | 期待結果 |
| --- | --- | --- | --- |
| DM-TAB-01 | `legacy` | precision=`legacy` で Diff Merge タブが非表示 | `DiffMergeTabs` が 5 タブのみ描画。`DiffMergeView` は `null`。 |
| DM-TAB-02 | `beta` → `stable` | `beta` で Compiled → Diff Merge タブ遷移後、`stable` に切替 | `activeTab` が `diff-merge` に固定、ハンク選択が持続。 |
| DM-TAB-03 | `stable` → `legacy` | `stable` から `legacy` へ降格 | ハンク選択リセット、Compiled タブへ戻る。 |
| DM-HUNK-01 | `stable` | Manual ボタン押下 → confirm | `queueMergeCommand('setManual')` が 1 回発火し、ハンクが `manual` 表示に遷移。 |
| DM-HUNK-02 | `stable` | AI ボタンで失敗 (`retryable=true`) | `Error` ステート表示、再試行で成功→`Idle`。 |
| DM-HUNK-03 | `stable` | EditModal 保存 | AutoSave ロック取得→`commitManualEdit` 発火→ロック解放イベントを待機。 |
| DM-HUNK-04 | `beta` | Bulk 操作で複数ハンク決定 | `queueBulk` が対象ハンク数分の更新イベントを受信。 |
| DM-MODAL-01 | `stable` | モーダル閉鎖時のフォーカス復帰 | 前回ボタンへフォーカスが戻る。 |
| DM-QUEUE-01 | 全 precision | `queueMergeCommand` が拒否（非 retryable） | バナー表示、Collector へ `merge:trace:error` を送信。 |
| DM-AUTOSAVE-01 | `stable` | 編集開始時の AutoSave 停止 | `autosaveLock='held'` 中は AutoSave が書込を遅延し、解放後に保存再開。 |

## 7. データフロー整合性
- `queueMergeCommand` 成功時に `merge.ts` が統計・JSONL ログを更新し、Day8 パイプラインへ渡す。【Day8/docs/day8/design/03_architecture.md】
- AutoSave はロックフェーズを尊重し、`current.json` と `index.json` の整合を維持する。【docs/AUTOSAVE-DESIGN-IMPL.md】

