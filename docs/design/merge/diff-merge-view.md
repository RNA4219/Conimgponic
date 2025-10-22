---
intent_id: INT-MERGE-DIFFVIEW
owner: platform-merge
status: draft
last_reviewed_at: 2025-02-17
next_review_due: 2025-03-17
---

# DiffMergeView / MergeDock 設計テンプレート

## メタデータ

```yaml
task_id: 20250217-diff-merge-view
repo: https://github.com/imgponic/Conimgponic
base_branch: main
work_branch: feat/diff-merge-view
priority: P1
langs: [typescript, react]
```

## 1. 対象モジュール
- `src/components/MergeDock.tsx`
- `src/components/DiffMergeView.tsx`
- `src/lib/merge.ts`

## 2. precision フラグ別タブ設計

| precision | タブ配列 (`MergeDock`) | 初期タブ | DiffMergeView マウント条件 | AutoSave/Lock 協調 | 備考 |
| --- | --- | --- | --- | --- | --- |
| `legacy` | `Compiled`, `Shot`, `Assets`, `Import`, `Golden` | `Compiled` | 常にアンマウント。`activeTab==='diff-merge'` は `compiled` へフォールバック。 | AutoSave ロックは `merge` スコープを要求しない。`queueMergeCommand` は noop。 | 既存 UI を維持し Diff タブへのショートカットも非表示。
| `beta` | 既存 5 タブ + `Diff Merge` (末尾) | `Compiled` | `queueMergeCommand('hydrate')` 成功時に遅延マウント。 | AutoSave `locks.isShared('project')` が true の場合、Diff タブを読み取り専用にし `aria-live` で警告。 | `Diff Merge (Beta)` バナーと再試行 CTA を表示し、`queueMergeCommand` はリトライ可能。
| `stable` | `Diff Merge`, `Compiled`, `Shot`, `Assets`, `Import`, `Golden` | `Diff Merge` | 常時マウント。`MergeDock` がタブスナップショットを `merge.lastTab` に保持。 | AutoSave が `project` ロックを独占するときは `MergeDock` がタブ変更をロックし、解除直後に `queueMergeCommand` キューを drain。 | CTA を主要ボタンへ昇格し、AutoSave `flushNow()` を確定実行。

- precision 降格時 (`stable→beta→legacy`) は `MergeDock` が Diff タブの DOM を破棄し、未完了キューをキャンセルする。
- AutoSave と同時編集を防ぐため、`DiffMergeView` は `locks.onChange` を購読し、ロック中は `queueMergeCommand` を enqueue のみに制限する。

## 3. コンポーネント構造と状態遷移

### 3.1 Component Tree

```mermaid
flowchart TD
    MergeDock --> DiffMergeTabs
    MergeDock -->|activeTab==='diff-merge'| DiffMergeView
    DiffMergeView --> StateController[useReducer Store]
    DiffMergeView --> HunkListPane
    DiffMergeView --> OperationPane
    DiffMergeView --> BannerStack
    OperationPane --> DecisionDeck
    OperationPane --> BulkActionBar
    OperationPane --> EditModal
    DiffMergeView --> TelemetryBridge[queueMergeCommand]
```

- `MergeDock` が precision に応じたタブ露出と初期化を制御し、Diff タブのみ `DiffMergeView` をマウントする。
- `DiffMergeView` は `useReducer` ベースのストアでハンク状態・ロック状態・AutoSave ステータスを集約する。

### 3.2 Hunk 状態機械

```mermaid
stateDiagram-v2
    [*] --> Unloaded
    Unloaded --> Hydrating: queueMergeCommand('hydrate')
    Hydrating --> Ready: commandResolved(success)
    Hydrating --> Error: commandResolved(error)
    Ready --> Inspecting: selectHunk
    Inspecting --> Editing: openEditModal
    Editing --> Inspecting: closeModal
    Inspecting --> BulkSelecting: openBulk
    BulkSelecting --> Ready: bulkResolved
    Inspecting --> Ready: commandResolved(success)
    Ready --> ReadOnly: autosave.lock('project')
    ReadOnly --> Ready: autosave.release('project')
    Error --> Ready: retryCommand
```

| 状態 | UI 表示 | トリガー | Exit 条件 |
| --- | --- | --- | --- |
| `Unloaded` | Diff ペイン非表示 | precision が `beta/stable` | `queueMergeCommand('hydrate')` |
| `Hydrating` | スケルトン表示 + CTA ローディング | 初期データフェッチ | `commandResolved(success/error)` |
| `Ready` | ハンク一覧 + 操作バー | 正常ロード済み | AutoSave 独占ロック or ユーザ操作 |
| `Inspecting` | ハンク詳細 / 操作ボタン | `selectHunk` | `commandResolved`, `openBulk`, `openEditModal` |
| `Editing` | 編集モーダル + focus trap | `openEditModal` | `closeModal`, `commandResolved` |
| `BulkSelecting` | 一括操作バー固定 | `openBulk` | `bulkResolved`, `closeBulk` |
| `ReadOnly` | バナー `「AutoSave により保存中…」` | AutoSave がロックを保持 | `autosave.release('project')` |
| `Error` | バナー `「再試行してください」` | `commandResolved(error)` | `retryCommand` |

### 3.3 `queueMergeCommand` フロー

```mermaid
sequenceDiagram
    participant UI as DiffMergeView
    participant Hub as Merge Event Hub (merge.ts)
    participant AutoSave as AutoSave Lock Manager
    UI->>Hub: queueMergeCommand(payload)
    Hub->>AutoSave: requestSharedLock('project')
    AutoSave-->>Hub: lockGranted | lockPending
    alt lockGranted
        Hub->>Hub: execute merge3 / legacy pipeline
        Hub-->>UI: commandResolved({ status, retryable })
    else lockPending
        UI->>UI: show "保存中…" banner, disable CTA
        AutoSave-->>Hub: lockReleased
        Hub->>Hub: resume command queue
        Hub-->>UI: commandResolved({ status, retryable })
    end
    UI->>AutoSave: flushNow() (success && precision in {beta,stable})
```

| ステップ | 説明 | precision 依存 | AutoSave 連携 |
| --- | --- | --- | --- |
| 1. enqueue | UI から `queueMergeCommand` を発行。payload は `type`, `hunkId`, `context`. | 全 precision | `ReadOnly` 時は enqueue のみで遅延実行。 |
| 2. lock 交渉 | `merge.ts` が AutoSave 共有ロック (`isShared`) を試行。 | `legacy` はスキップ。`beta/stable` は必須。 | `lockPending` 時は UI にローディングバナー。 |
| 3. 実行 | ロック取得後に `merge3` or レガシーパイプラインを実行。 | `beta/stable` は Diff ハンク更新、`legacy` は従来処理。 | 実行時間が SLA 超過なら `retryable=true` を付与。 |
| 4. 結果通知 | `commandResolved` を UI へ通知しステータス更新。 | 全 precision | `retryable` の場合 UI がリトライ CTA を露出。 |
| 5. AutoSave flush | 成功かつ Diff タブ有効時は AutoSave `flushNow()`。 | `beta/stable` のみ | ロック解除タイミングを Telemetry へ送信。 |

## 4. リスクとロック協調要件
- AutoSave 独占ロック (`exclusive`) 発生時は `MergeDock` がタブ操作を無効化し、解除後に `merge.lastTab` を復元する。
- Diff タブが `legacy` へ降格した際は `queueMergeCommand` キューを破棄し、AutoSave へ `releaseShared('project')` を明示送信する。
- `retryable=false` のエラーでは `MergeDock` が `Compiled` タブへ遷移し、Diff 状態を再初期化する。

## 5. `tests/merge/diff-merge-view.spec.ts` TDD チェックリスト

### 5.1 キーボード操作
- [ ] `ArrowLeft/Right` で `role="tab"` が precision ごとのタブ配列順に移動する。
- [ ] `ArrowUp/Down` でハンクリストのフォーカスが移動し、`Enter` で詳細パネルへ遷移する。
- [ ] `Esc` で編集モーダルが閉じ、フォーカスが元のハンクへ戻る。

### 5.2 バナー表示
- [ ] AutoSave ロック中に `"保存中…"` バナーが `aria-live="polite"` で表示される。
- [ ] `retryable` エラー時に警告バナーが `aria-live="assertive"` で読み上げられる。
- [ ] precision 降格 (`stable→beta`) 後に Diff 特有バナーが DOM から除去される。

### 5.3 コマンド送出
- [ ] `queueMergeCommand('hydrate')` 成功後に `commandResolved` が `Ready` 状態へ遷移させる。
- [ ] AutoSave 独占ロック中でもコマンドがエンキューされ、解除後にまとめて実行される。
- [ ] `retryable=false` エラーで `MergeDock` が `Compiled` タブへ戻り、Diff ステートが破棄される。

### 5.4 リスク / ロールバック条件
- [ ] AutoSave ロック解除イベントが 5 秒以内に届かない場合は Diff タブを自動で隠蔽する。
- [ ] precision を `legacy` へ戻した際に未処理コマンドが全てドロップされる。
- [ ] Telemetry が `merge.precision.blocked` を受信した場合、Diff タブを非表示にして既存 UI へロールバックする。

