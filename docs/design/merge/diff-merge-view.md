---
intent_id: INT-MERGE-DIFFVIEW
owner: platform-merge
status: draft
last_reviewed_at: 2025-03-04
next_review_due: 2025-04-04
---

# DiffMergeView / MergeDock 設計テンプレート

## メタデータ

```yaml
task_id: 20250304-diff-merge-view
repo: https://github.com/imgponic/Conimgponic
base_branch: main
work_branch: feat/diff-merge-view
author: platform-merge
priority: P1
langs: [typescript, react]
```

## 1. 対象モジュール
- `src/components/MergeDock.tsx`
- `src/components/DiffMergeView.tsx`
- `src/components/DiffMergeTabs.tsx`
- `src/lib/merge.ts`
- `tests/merge/diff-merge-view.spec.ts`

## 2. precision フラグ別タブ設計

`docs/MERGE-DESIGN-IMPL.md` §5 と `docs/IMPLEMENTATION-PLAN.md` §0.3 の指針を継承し、`merge.precision` ごとのタブ構成・初期表示・AutoSave 協調要件を下表に整理する。

| precision | タブ配列 (`MergeDock`) | 初期タブ | DiffMergeView マウント条件 | AutoSave/Lock 協調 | 備考 |
| --- | --- | --- | --- | --- | --- |
| `legacy` | `Compiled`, `Shot`, `Assets`, `Import`, `Golden` | `Compiled` | 常にアンマウント。`activeTab==='diff-merge'` は `compiled` へフォールバック。 | AutoSave は `merge` スコープの共有ロックを要求しない。`queueMergeCommand` は noop。 | 従来 UI を維持し Diff ショートカット非表示。 |
| `beta` | 上記 5 タブ + `Diff Merge (Beta)` (末尾) | `Compiled` | `queueMergeCommand('hydrate')` 成功時に遅延マウント。 | AutoSave `locks.isShared('project')` が true の間は読み取り専用モード。警告バナーを `aria-live` 表示。 | `queueMergeCommand` はリトライ可、AutoSave `flushNow()` を成功時に非同期発行。【F:docs/MERGE-DESIGN-IMPL.md†L168-L206】 |
| `stable` | `Diff Merge`, `Compiled`, `Shot`, `Assets`, `Import`, `Golden` | `Diff Merge` | 常時マウント。`MergeDock` がタブスナップショットを `merge.lastTab` に保持。 | AutoSave が `project` ロックを独占するときはタブ変更・CTA をロックし、解除後に `queueMergeCommand` キューを drain。 | CTA を主要ボタンへ昇格し、AutoSave `flushNow()` を即時実行。【F:docs/IMPLEMENTATION-PLAN.md†L56-L104】 |

precision 降格時 (`stable→beta→legacy`) は Diff タブ DOM を破棄し、未完了コマンドをキャンセルする。AutoSave ロック中の降格は `queueMergeCommand` キューを保持したまま `retryable` エラーで UI に通知する。【F:docs/MERGE-DESIGN-IMPL.md†L188-L205】

## 3. コンポーネントツリー

`docs/MERGE-DESIGN-IMPL.md` §5.1 の構造を図化し、各ノードの責務と対象モジュールを列挙する。

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

| ノード | 役割 | 実装ポイント | precision 依存 | AutoSave 連携 |
| --- | --- | --- | --- | --- |
| `MergeDock` | タブ構成と初期タブを precision で切替。 | `src/components/MergeDock.tsx` | `legacy` で Diff タブ非表示。 | AutoSave 独占ロック時はタブ遷移を抑止。 |
| `DiffMergeTabs` | タブ見出しレンダリングとキーボードナビゲーション。 | `src/components/DiffMergeTabs.tsx` | `beta/stable` のみ。 | AutoSave バナー発火時に `tabIndex` を制御。 |
| `DiffMergeView` | ハンク状態・ロック状態ストアを集約。 | `src/components/DiffMergeView.tsx` | `beta/stable` のみマウント。 | `locks.onChange` を購読し CTA を制御。 |
| `HunkListPane` | ハンク一覧とフィルタ。 | `DiffMergeView.tsx` 内部 | `legacy` 非表示。 | AutoSave ロック中は `aria-disabled`。 |
| `OperationPane` | 個別/一括操作 UI。 | `DiffMergeView.tsx` 内部 | `beta/stable` | AutoSave ロック中は操作無効化。 |
| `BannerStack` | バナー/トースト制御。 | `DiffMergeView.tsx` 内部 | 全 precision | AutoSave・`retryable` を集約表示。 |
| `TelemetryBridge` | `queueMergeCommand` 送出とイベント購読。 | `src/lib/merge.ts` | 全 precision | AutoSave `flushNow()` 呼出順を保証。 |

## 4. タブ状態機械

`docs/MERGE-DESIGN-IMPL.md` §5.2 と実装計画の precision 遷移図を反映し、タブ状態と Diff ハンク状態を統合したステートマシンを定義する。

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

    state Precision {
        [*] --> Legacy
        Legacy --> Beta: setPrecision('beta')
        Beta --> Stable: setPrecision('stable')
        Stable --> Beta: downgrade('beta')
        Beta --> Legacy: downgrade('legacy')
    }

    Ready --> Precision.Beta: precisionChange
    Precision.Beta --> Hydrating: mountDiff
    Precision.Stable --> Ready: hydrateComplete
    Precision.Beta --> Precision.Legacy: rollbackLegacy
```

- `Precision` サブマシンは `MergeDock` のタブ露出を制御し、`setPrecision`/`downgrade` でタブ DOM を追加・破棄する。【F:docs/IMPLEMENTATION-PLAN.md†L56-L104】
- `Ready` から `Precision.Beta` への遷移は Diff タブ表示後の `hydrate` 処理と同期し、ロールバック時 (`rollbackLegacy`) は Diff 状態・テレメトリを破棄する。【F:docs/MERGE-DESIGN-IMPL.md†L170-L206】

## 5. `queueMergeCommand` フロー

`docs/MERGE-DESIGN-IMPL.md` §5.3 の手順をベースに、AutoSave 共有ロックとの協調を図示する。

```mermaid
sequenceDiagram
    participant UI as DiffMergeView
    participant Hub as Merge Event Hub (merge.ts)
    participant AutoSave as AutoSave Lock Manager
    UI->>Hub: queueMergeCommand(payload)
    Hub->>AutoSave: requestSharedLock('project')
    AutoSave-->>Hub: lockGranted / lockPending
    alt lockGranted
        Hub->>Hub: execute merge3 / legacy pipeline
        Hub-->>UI: commandResolved({ status, retryable })
    else lockPending
        UI->>UI: show "保存中…" banner
        AutoSave-->>Hub: lockReleased
        Hub->>Hub: resume queued commands
        Hub-->>UI: commandResolved({ status, retryable })
    end
    opt success && precision in {beta, stable}
        UI->>AutoSave: flushNow()
    end
```

| 手順 | 詳細 | precision 影響 | AutoSave 協調 | リスク緩和 |
| --- | --- | --- | --- | --- |
| 1. enqueue | UI から `queueMergeCommand` を発行し、`payload` をストアにバッファ。 | 全 precision | ロック中は enqueue のみ許可。 | `merge.lastTab` を保持し UI 復帰を保証。 |
| 2. lock 交渉 | `merge.ts` が AutoSave 共有ロックを取得。 | `legacy` はスキップ。 | `lockPending` 時にローディングバナー表示。 | 5 秒超過で `retryable` エラーとし UI へ警告。 |
| 3. 実行 | ロック取得後に `merge3` または従来処理を実行。 | `beta/stable` で Diff ハンク更新。 | ロック解除まで結果適用を遅延。 | 失敗時は `retryable` 判定でリトライ経路を分岐。 |
| 4. 結果通知 | `commandResolved` を発火し UI ステータス更新。 | 全 precision | `retryable=false` で `MergeDock` を `compiled` へ戻す。 | Diff 状態破棄で不整合防止。 |
| 5. AutoSave flush | 成功時に `flushNow()` を連携。 | `beta/stable` のみ | ロック解除直後に実行。 | Telemetry でロック時間を追跡。 |

## 6. AutoSave ロック協調要件

- `AutoSave` の共有ロック (`requestSharedLock('project')`) が未取得の場合、Diff タブ操作はバナー表示と CTA 無効化で待機する。
- 独占ロック (`lockExclusive`) を検出した場合は `ReadOnly` 状態へ遷移し、タブ切替を封止。解除後に `queueMergeCommand` の未処理エントリを再実行する。
- AutoSave が `saved` を発火するまで `persistMergeTrace` を保留し、`merge:trace:persisted` と AutoSave 証跡の順序を固定する。【F:docs/MERGE-DESIGN-IMPL.md†L205-L222】

## 7. テスト設計 (`tests/merge/diff-merge-view.spec.ts`)

TDD を前提に、`node:test` で実装するユニット/結合テストの観点を整理する。

| カテゴリ | ケース | シナリオ | 期待挙動 |
| --- | --- | --- | --- |
| キーボード操作 | タブ左右移動 | `precision='beta'` で `ArrowRight` を送出すると Diff タブへ移動し、AutoSave ロック中は `tabIndex=-1` でスキップ。 | タブフォーカスが `diff-merge` に遷移し、ロック時は `compiled` に留まる。 |
| キーボード操作 | ハンクリストショートカット | `Alt+J/K` でハンク選択を前後移動。 | `selectHunk` アクションが発火し、`Inspecting` 状態へ遷移。 |
| バナー表示 | AutoSave 待機 | `lockPending` イベントで「保存中…」バナーを表示。 | バナー DOM が `aria-live=polite` で描画され、CTA が disabled。 |
| バナー表示 | `retryable` エラー | `commandResolved({retryable:true})` を受信。 | バナーに再試行 CTA が表示され、`retryCommand` 送出で閉じる。 |
| コマンド送出 | `queueMergeCommand('hydrate')` | Diff タブ初回表示時。 | `requestSharedLock` → `merge3` 呼出をモック検証。 |
| コマンド送出 | AutoSave flush | 成功時 (`status==='success'`)。 | `flushNow()` が precision `beta/stable` のみ呼ばれる。 |

## 8. リスク / ロールバック条件

- **AutoSave ロック遅延**: 共有ロックが 5 秒超過で未取得の場合、UI は `retryable` バナーを継続表示し、`queueMergeCommand` キューを維持する。ロールバック時は Diff タブ DOM を破棄し、未処理コマンドをキャンセルする。【F:docs/MERGE-DESIGN-IMPL.md†L188-L206】
- **precision 降格**: `stable` から `beta/legacy` へ降格する際、`merge.lastTab` を `compiled` に設定し Diff 状態・テレメトリを破棄する。ロック中は降格を保留し、解除後に再評価する。【F:docs/IMPLEMENTATION-PLAN.md†L74-L104】
- **`retryable=false` エラー**: `queueMergeCommand` が非再試行エラーを返した場合、Diff タブを非表示に戻し `MergeDock` を従来 UI にフォールバック。AutoSave には `releaseShared('project')` を送信し整合性を確保する。【F:docs/MERGE-DESIGN-IMPL.md†L205-L222】
