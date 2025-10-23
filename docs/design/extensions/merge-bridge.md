# Merge Bridge 拡張設計

## 1. 目的とスコープ
- VSCode 拡張の Merge Dock から OPFS/Collector パイプラインまで一貫した差分適用フローを整備する。
- `merge.precision` フラグに基づき Beta/Stable モードを段階導入し、`docs/IMPLEMENTATION-PLAN.md` §0.3 のタブ/ペイン構成と一致させる。【F:docs/IMPLEMENTATION-PLAN.md†L120-L206】
- AutoSave の保存ポリシー（50MB/20世代）と Collector/Analyzer/Reporter の責務境界を尊重し、Evidence JSON を破壊的に変更しない。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L33-L104】【F:Day8/docs/day8/design/03_architecture.md†L1-L38】

## 2. Payload 型案

```ts
// merge.request
export interface MergeRequestPayload {
  traceId: string
  profile: {
    threshold: number // 0.0–1.0, 既定 0.72 を上書き可
    seed?: string
    precision: 'legacy' | 'beta' | 'stable'
  }
  sources: {
    baseUri: string
    oursUri: string
    theirsUri: string
  }
  ui: {
    tab: 'compiled' | 'diff' | 'operation'
    pane?: 'hunk-list' | 'operation' | 'edit' | 'bulk'
  }
}

// merge.result
export interface MergeResultPayload {
  traceId: string
  profile: {
    threshold: number
    seed?: string
    precision: 'legacy' | 'beta' | 'stable'
  }
  hunks: Array<{
    path: string
    decision: 'auto_ours' | 'auto_theirs' | 'conflict' | 'manual'
    sim?: number
    ours?: string
    theirs?: string
    rollbackCommand?: { type: 'revert-hunk'; command: string }
  }>
  commands: Array<{
    type: 'apply' | 'rollback'
    command: string
  }>
  evidence: EvidenceEnvelope
}

export interface EvidenceEnvelope {
  version: '2024-merge-bridge'
  profile: { threshold: number; seed?: string }
  hash: string // evidence JSON 本体 (hunks, commands, profile) の SHA-256
  storage: { path: 'collector/merge/*.jsonl'; retryable: boolean }
}
```

- 既存 MERGE 仕様の `profile.threshold` とハンク決定ルールを保ちつつ、`precision` を Evidence に明示する。【F:docs/src-1.35_addon/MERGE.md†L3-L23】
- `traceId` は UI へ即返却し、Collector には Evidence と同一ハッシュで送出する。

## 3. 証跡 JSON 整合と UI 更新シーケンス

### 3.1 Evidence JSON 整合
1. Merge Bridge は `merge.request` を受け取り、`profile.threshold` を正規化（0.0–1.0）する。
2. ハンク決定後に `merge.result` を生成し、`EvidenceEnvelope` を構築。
3. Evidence 本体（`profile` + `hunks` + `commands`）を安定化ソート（path asc, decision asc）し SHA-256 を計算。
4. Collector へ `{ traceId, evidence }` を JSONL append し、Analyzer 経由で Reporter に伝搬する。【F:Day8/docs/day8/design/03_architecture.md†L19-L38】
5. AutoSave と競合しないよう、Evidence サイズが 50MB を超える場合は即座に retryable=false エラーで UI/Collector へ通知する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L57-L104】

### 3.2 UI 更新シーケンス
1. `Diff` タブ選択時に `merge.request` を送信し、`traceId` を保持。
2. 成功時: `MergeDock` は `merge.result.hunks` を `HunkListPane` へ渡し、`OperationPane` は選択ハンクを監視。
3. `decision='conflict'` のハンクを選択した場合、`OperationPane` がロールバックコマンドと共に詳細モーダルを表示。
4. `commands` に `apply` が存在する場合は AutoSave の `flushNow()` をトリガして整合性を確保。
5. `Compiled` タブへ戻る際に `merge.trace` イベントを再送し、Collector ログと UI state を同期する。【F:docs/IMPLEMENTATION-PLAN.md†L187-L206】

## 4. エラー分類とロールバック方針

| エラーコード | 例外階層 | retryable | UI 表示 | Collector ログ | ロールバック方針 |
| --- | --- | --- | --- | --- | --- |
| `merge.threshold-invalid` | `MergeBridgeError` | false | トースト (error) + Diff タブへ固定 | `merge.error` (severity=error) | リクエスト破棄、既定 0.72 へ復旧。
| `merge.hunk-conflict` | `MergeBridgeConflictError` | true | ハンク毎バッジ + Operation モーダル | `merge.trace` (conflict flag) | ロールバックコマンドを `commands` へ付与し、UI で手動解決を促す。
| `merge.evidence-oversize` | `MergeBridgeError` | false | トースト (error) + 詳細リンク | `merge.error` (severity=error) | Evidence を破棄し、Diff タブへ留める。AutoSave は無変更。
| `merge.collector-failed` | `MergeBridgeError` | true | トースト (warn) + リトライボタン | `merge.error` (severity=warn) | Evidence をローカルに保存（OPFS 一時ファイル）し、Collector 再送を待機。
| `merge.trace-mismatch` | `MergeBridgeError` | false | トースト (error) + TraceId 表示 | `merge.error` (severity=error) | `commands` を無効化し、Diff タブで再リクエストを促す。

- 全ての例外は AutoSave の `retryable` 判定と同等のポリシーで UI/Collector へ伝搬し、副作用を隔離する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L13-L66】
- `merge.collector-failed` のロールバックでは Evidence をローカルで保持し、Collector 復旧後に Analyzer が重複排除する。

## 5. ロールアウトと段階的導入
- Phase B (precision=`beta`): `merge.request.profile.precision` を `beta` に固定し、`threshold` 上書きを限定ロールアウト。
- Phase C (precision=`stable`): UI 初期タブを Diff へ切替え、`commands` に `bulk` 系操作を追加。`docs/IMPLEMENTATION-PLAN.md` のチェックリストに従い、Collector 指標±5%を維持する。【F:docs/IMPLEMENTATION-PLAN.md†L33-L80】
- ロールバック時は `merge.precision` を `legacy` へ戻し、Diff 関連タブ/ペインを非表示にする。
