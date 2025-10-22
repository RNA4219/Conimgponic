# DiffMergeView / MergeDock 統合設計

- **対象コンポーネント**: `src/components/DiffMergeView.tsx`, `src/components/MergeDock.tsx`
- **参照資料**: [AUTOSAVE-DESIGN-IMPL](../AUTOSAVE-DESIGN-IMPL.md), [Day8 Architecture](../../Day8/docs/day8/design/03_architecture.md), [MERGE-DESIGN-IMPL](../MERGE-DESIGN-IMPL.md)
- **目的**: precision フラグの段階的ロールアウトに合わせたタブ構成とハンク操作の UI/データフローを整理し、Analyzer/Reporter とのモニタリング整合を保証する。

## 1. タブ構成と precision フラグ連動

| precision フェーズ | `MergeDock` タブ配列 (`DiffMergeTabs`) | 初期アクティブタブ (`activeTab`) | Diff タブ露出条件 | 備考 |
| --- | --- | --- | --- | --- |
| `legacy` | `Compiled`, `Shotlist`, `Assets`, `Import`, `Golden` | `Compiled` | 非表示 (`pref` 選択肢にも `diff-merge` を含めない) | `DiffMergeView` はアンマウントし、既存 5 タブの DOM を再利用。 |
| `beta` | 既存 5 タブ + `Diff Merge` を末尾追加 | `Compiled` | `pref` に `diff-merge` 追加。タブ表示は `queueMergeCommand` が `ready` であることが条件。 | `DiffMergeView` は遅延ロード。初回アクセス時に `merge3` 結果をフェッチ。 |
| `stable` | `Diff Merge`, `Compiled`, `Shotlist`, `Assets`, `Import`, `Golden` | `Diff Merge` | 常時表示 (`pref` 初期値を `diff-merge` に設定)。 | `Compiled` タブへ差分サマリバッジを表示して整合。 |

- precision 切替時は `MergeDock` が `activeTab` を再解決し、`legacy → beta/stable` では `DiffMergeView` の内部ステートを `restoreSnapshot()` して再描画。
- `DiffMergeTabs` は `useMemo` で precision ごとのタブリストを再構成し、既存タブのキーを維持して再マウントを防ぐ。

## 2. 画面遷移図 (テキスト表現)

```
stateDiagram-v2
    [*] --> Compiled
    Compiled --> DiffMerge: precision in {beta, stable} && tab==='diff-merge'
    DiffMerge --> Compiled: BackToLegacy
    DiffMerge --> Shotlist: TabChange('shot')
    Shotlist --> DiffMerge: TabChange('diff-merge')
    DiffMerge --> Operation: SelectHunk
    Operation --> DiffMerge: CloseOperation
    DiffMerge --> Modal: queueMergeCommand('openModal')
    Modal --> DiffMerge: queueMergeCommand('closeModal')
    DiffMerge --> [*]: precision==='legacy'
```

- `BackToLegacy` イベントは `precision` が `legacy` へ変化した際に発火し、`DiffMergeView` をアンマウント。
- `Operation` は `OperationPane` を指し、ハンク選択やアクションモーダルを含む。

## 3. ハンク操作データフロー (`queueMergeCommand` 中心)

```
DiffMergeView (UI)
  ├─ selects hunk → `setSelectedHunk(hunkId)`
  ├─ edits decision → `queueMergeCommand({ type: 'draftDecision', hunkId, payload })`
  ├─ applies decision → `queueMergeCommand({ type: 'applyDecision', hunkId })`
  └─ requests revert → `queueMergeCommand({ type: 'revertDecision', hunkId })`
      ↓
Merge Event Hub (`merge.ts`)
  ├─ validates payload / obtains AutoSave lock (`navigator.locks`, cf. AUTOSAVE-DESIGN-IMPL §2)
  ├─ executes merge engine command (`merge3` or legacy)
  └─ emits result via `subscribeMergeEvents`
      ↓
DiffMergeView effects
  ├─ `onSuccess`: update local hunk state, show toast, release lock
  ├─ `onConflict`: show banner, keep modal open
  └─ `onError`: classify by `retryable`; if true expose `Retry` CTA, else redirect to `Compiled`
      ↓
Analyzer / Reporter
  ├─ receives `merge:ui:*` telemetry events
  └─ correlates with AutoSave `autosave.lock.merge.*` events for observability alignment
```

- `queueMergeCommand` 呼び出し前に `DiffMergeView` は入力検証を実施 (`selectedHunkId` 必須、編集内容の必須チェック)。
- `subscribeMergeEvents` から受け取るイベントに `origin='diff-merge'` を付加して Analyzer/Reporter がタブ由来を判別可能にする。

## 4. インタラクション仕様

| 操作 | precision 条件 | UI 動作 | イベント/コールバック |
| --- | --- | --- | --- |
| タブ切替 (`Diff Merge` 押下) | `beta/stable` | `activeTab` を `diff-merge` に更新、`DiffMergeView` をマウント | `onTabChange('diff-merge')` → `MergeDock` が `pref` を `diff-merge` に設定 |
| ハンク選択 | `beta/stable` + `activeTab==='diff-merge'` | `HunkListPane` が選択ハイライト、`OperationPane` に詳細表示 | `setSelectedHunk` 内部 state 更新 |
| 編集開始 | 同上 | モーダルを開き AutoSave ロックを取得 | `queueMergeCommand({type:'startEditing'})` → `autosave.lock.merge.editing` |
| AI 提案採用 | `beta/stable` | モーダル閉鎖、ハンク状態を `accepted` に更新 | `queueMergeCommand({type:'applyDecision', mode:'ai'})` |
| 手動編集確定 | `beta/stable` | 編集内容を反映し再レンダリング | `queueMergeCommand({type:'applyDecision', mode:'manual'})` |
| 差分比較表示 | `beta/stable` | `DiffPane` で前後差分をレンダリング | `queueMergeCommand({type:'previewDiff'})` (読み取りのみ) |
| 精度 `legacy` ダウンシフト | precision 変更 | `DiffMergeView` アンマウント、`activeTab` を `compiled` にリセット | `onPrecisionChange('legacy')` → `MergeDock` が状態初期化 |

## 5. Analyzer / Reporter 監視整合

- `DiffMergeView` は各操作時に `merge:ui:tab_change`, `merge:ui:hunk_select`, `merge:ui:command` などのイベントを `MergeAnalyticsReporter` に送出。payload に `precision`, `activeTab`, `hunkId`, `commandType` を含める。
- AutoSave ロック制御イベント (`autosave.lock.merge.editing`) と `queueMergeCommand` 結果イベント (`merge:command:success|error`) を correlation ID (`mergeSessionId`) で紐付け、Analyzer がロールアウトフェーズ毎の健全性を追跡。
- Reporter 側は `precision==='legacy'` で `diff-merge` イベントが来た場合に WARN を出し、フラグ設定不整合を検知。

## 6. テストケース計画

### 6.1 precision モード別

1. **DM-TAB-01 (`legacy`)**: Diff Merge タブ非表示、`activeTab` が `compiled` 継続。`pref` から `diff-merge` 除外。
2. **DM-TAB-02 (`beta`)**: タブ末尾追加。`queueMergeCommand` が `ready` になるまでスケルトン表示。
3. **DM-TAB-03 (`stable`)**: タブ先頭表示。初期アクティブが `diff-merge`。

### 6.2 ハンク操作

4. **DM-HUNK-01**: ハンク選択時に `queueMergeCommand({type:'previewDiff'})` が一度だけ発火し、`selectedHunkId` が更新される。
5. **DM-HUNK-02**: 編集確定で `merge:command:success` を受信 → ハンク状態更新 + AutoSave ロック解放。
6. **DM-HUNK-03**: `retryable=false` エラー受信でエラーバナー表示、`Compiled` へ自動遷移。
7. **DM-HUNK-04**: `retryable=true` エラーでリトライボタン表示、`queueMergeCommand` 再試行で成功イベントを確認。

### 6.3 precision 切替

8. **DM-PREC-01**: `beta→legacy` 切替で `DiffMergeView` がアンマウントし、内部状態がスナップショットへ保存。
9. **DM-PREC-02**: `legacy→beta` 復帰でスナップショットが復元され、`selectedHunkId` が再適用。

- 各テストは `node:test` + React Testing Library を想定。AutoSave ロックはモック (`navigator.locks`) で再現。【docs/AUTOSAVE-DESIGN-IMPL.md】

## 7. Task Seed

1. `MergeDock` に precision 判定ロジックを導入し、`DiffMergeTabs` を実装してタブ構成を動的制御。
2. `DiffMergeView` コンポーネントを実装し、`queueMergeCommand` ハンドラと `subscribeMergeEvents` 購読を組み込む。
3. AutoSave ロック連携 (`navigator.locks`) を DiffMerge 操作に統合。
4. Analyzer/Reporter 連携のテレメトリ発火点 (`merge:ui:*`) を整備。
5. テストスイート (`node:test`) を precision フェーズ別に追加。

---
- **Self-check**: Lint/Type/Test は本設計での想定差分にてパス見込み。
