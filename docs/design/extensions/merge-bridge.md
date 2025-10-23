# Merge Bridge 設計ノート

## 0. 前提と参照
- 本ドキュメントは `merge.precision` のモード遷移（legacy/beta/stable）と DiffMergeView のタブ・ペイン構成をもとに、VS Code 拡張とのメッセージ橋渡し仕様を統合する。【F:docs/IMPLEMENTATION-PLAN.md†L56-L164】【F:docs/design/merge/diff-merge-view.md†L23-L154】
- AutoSave の保存ポリシーおよびロック連携、Day8 Collector/Analyzer/Reporter のデータフローと整合させる。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L1-L152】【F:Day8/docs/day8/design/03_architecture.md†L1-L36】
- Merge アルゴリズム要件は `docs/src-1.35_addon/MERGE.md` と API 契約（`merge.request` / `merge.result`）の型仕様を参照する。【F:docs/src-1.35_addon/MERGE.md†L1-L25】【F:docs/src-1.35_addon/API-CONTRACT-EXT.md†L33-L86】

## 1. precision モード別タブ/ペイン I/O 一覧

| precision | タブ/ペイン | 主入力 | 主出力 | UI/副作用 | 出典 |
| --- | --- | --- | --- | --- | --- |
| legacy | `MergeDock` `Compiled`/`Shot`/`Assets`/`Import`/`Golden` | `Storyboard` 現行スナップショット | レガシービュー描画のみ | Diff Merge タブはプレースホルダー、`pref` は `manual-first` / `ai-first` のみ。【F:docs/IMPLEMENTATION-PLAN.md†L74-L115】 | `MergeDock.tsx` 挙動計画。【F:docs/design/merge/diff-merge-view.md†L41-L84】 |
| legacy | Diff ペイン群（非マウント） | - | - | `DiffMergeView` をアンマウントし、`queueMergeCommand` は noop。【F:docs/design/merge/diff-merge-view.md†L58-L84】 | precision 遷移図。【F:docs/IMPLEMENTATION-PLAN.md†L116-L164】 |
| beta | `MergeDock` 末尾 `Diff Merge (Beta)` | `merge.precision='beta'`, `queueMergeCommand('hydrate')` | Diff タブ遅延マウント命令 | AutoSave 共有ロック待機バナー、`flushNow()` 非同期実行。【F:docs/design/merge/diff-merge-view.md†L41-L122】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L55-L132】 | precision=`beta` 遷移。【F:docs/IMPLEMENTATION-PLAN.md†L123-L153】 |
| beta | `HunkListPane` | `merge.result.hunks`（決定/競合/類似度） | ハンク一覧、フィルタ状態 | AutoSave ロック中は `aria-disabled`。競合は UI に昇格。【F:docs/design/merge/diff-merge-view.md†L85-L154】【F:docs/src-1.35_addon/MERGE.md†L7-L25】 | - |
| beta | `OperationPane` | 選択ハンク、`profile.threshold` | CTA（自動採択/競合解消） | `threshold` 上書きは `merge.request.payload.threshold` を反映。AutoSave ロック中は CTA 無効。【F:docs/design/merge/diff-merge-view.md†L85-L154】【F:docs/src-1.35_addon/MERGE.md†L7-L25】 | - |
| beta | `BannerStack` | `merge.result.trace` / AutoSave `lock:*` イベント | トースト/バナー表示 | 競合通知をテレメトリ送信し Collector へ連携。【F:docs/design/merge/diff-merge-view.md†L85-L154】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L55-L152】【F:Day8/docs/day8/design/03_architecture.md†L1-L36】 | - |
| stable | `MergeDock` 先頭 `Diff Merge` | `merge.precision='stable'`, `merge.lastTab` | Diff 初期表示 | AutoSave 独占ロック時はタブ切替封止。【F:docs/design/merge/diff-merge-view.md†L41-L122】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L55-L132】 | - |
| stable | `OperationPane` + `EditModal` + `BulkActionBar` | `merge.result.hunks`, ユーザー操作トレース | コマンド enqueue, 編集確定, バルク適用 | AutoSave 解除後に一括処理。`trace` へ操作列を追記。【F:docs/design/merge/diff-merge-view.md†L85-L154】【F:docs/src-1.35_addon/MERGE.md†L7-L25】 | - |
| stable | `TelemetryBridge` | `queueMergeCommand` フロー, AutoSave イベント | `merge:*` JSONL, `autosave.*` | Collector/Analyzer へ伝播し、閾値逸脱時はロールバック判定。【F:docs/design/merge/diff-merge-view.md†L124-L206】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L55-L180】【F:Day8/docs/day8/design/03_architecture.md†L1-L36】 | - |

## 2. `merge.request` / `merge.result` 型草案

```ts
/** envelope 共通部。 */
type MergeBridgeEnvelope = {
  apiVersion: 1;
  reqId: string;
  ts: number;
};

/** Webview → Extension: マージ要求。 */
interface MergeRequestMessage extends MergeBridgeEnvelope {
  type: 'merge.request';
  payload: MergeRequestPayload;
}

interface MergeRequestPayload {
  base: MergeDocumentSnapshot;
  ours: MergeDocumentSnapshot;
  theirs: MergeDocumentSnapshot;
  precision: 'legacy' | 'beta' | 'stable';
  /** しきい値上書き（UI からの手動指定）。未指定時は 0.72 を採用。 */
  threshold?: number;
  /** UI からの操作追跡。Diff タブ起点の trace を構築する。 */
  trace?: MergeRequestTrace;
}

type MergeDocumentSnapshot = {
  sceneId: string;
  sections: readonly MergeSection[];
};

interface MergeSection {
  path: string;           // 例: "scenes[3].manual"
  text: string;
  tokens?: readonly string[]; // precision=stable のセグメントキャッシュ
}

interface MergeRequestTrace {
  originTab: 'compiled' | 'diff';
  focusHunkId?: string;
  submittedBy: 'operation-pane' | 'bulk-action' | 'edit-modal';
  autoSavePhase: 'idle' | 'awaiting-lock' | 'readonly';
}

/** Extension → Webview: マージ結果。 */
interface MergeResultMessage extends MergeBridgeEnvelope {
  type: 'merge.result';
  ok: boolean;
  result?: MergeResultPayload;
  trace?: MergeResultTrace;
  error?: MergeBridgeError;
}

interface MergeResultPayload {
  profile: { threshold: number; seed: string; precision: 'legacy' | 'beta' | 'stable' };
  hunks: readonly MergeHunkResult[];
  mergedText?: string; // legacy/beta 互換出力
  stats?: { autoApplied: number; conflicts: number; durationMs: number };
}

type MergeHunkResult =
  | { decision: 'auto_ours' | 'auto_theirs'; path: string; sim: number }
  | { decision: 'conflict'; path: string; ours: string; theirs: string; sim?: number };

interface MergeResultTrace {
  events: readonly MergeTraceEvent[];
  telemetry?: MergeTelemetrySnapshot;
}

type MergeTraceEvent =
  | { type: 'queue'; hunkIds: readonly string[]; requestedAt: string }
  | { type: 'lock.pending'; strategy: 'web-lock' | 'file-lock'; retry: number }
  | { type: 'lock.released'; releasedAt: string }
  | { type: 'apply.auto'; hunkId: string; decidedAt: string }
  | { type: 'apply.conflict'; hunkId: string; decidedAt: string; retryable: boolean };

interface MergeTelemetrySnapshot {
  collectorSurface: string;
  analyzerSurface: string;
  autoSave: { phase: 'idle' | 'pending' | 'readonly'; lastFlushAt?: string };
}

interface MergeBridgeError {
  code: 'merge.unexpected' | 'merge.threshold.invalid' | 'merge.lock.timeout';
  message: string;
  retryable: boolean;
  details?: unknown;
}
```

### 2.1 DiffMergeView へのマッピング

| DiffMergeView 参照先 | 必須フィールド | 供給元 | 備考 |
| --- | --- | --- | --- |
| タブ初期化 (`useReducer` Store) | `result.profile.precision`, `result.hunks` | `MergeResultMessage.result` | precision でタブ DOM を再構成。【F:docs/design/merge/diff-merge-view.md†L41-L122】 |
| ハンク一覧 | `result.hunks[]` (`decision`, `sim`, `ours`, `theirs`) | `MergeHunkResult` | 競合検知時に OperationPane へ橋渡し。【F:docs/src-1.35_addon/MERGE.md†L7-L25】 |
| しきい値 UI | `payload.threshold` / `result.profile.threshold` | `MergeRequestPayload`, `MergeResultPayload` | 手動入力と結果の差分を提示。【F:docs/src-1.35_addon/MERGE.md†L7-L25】 |
| AutoSave 連携 | `payload.trace.autoSavePhase`, `trace.events` (lock) | `MergeRequestTrace`, `MergeResultTrace` | バナー表示・ReadOnly 遷移条件を統一。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L55-L152】 |
| TelemetryBridge | `trace.telemetry.collectorSurface` など | `MergeTelemetrySnapshot` | Collector/Analyzer への JSONL を組み立て。【F:Day8/docs/day8/design/03_architecture.md†L1-L36】 |

## 3. `tests/extensions/vscode/merge-bridge.spec.ts` (RED) 観点
- **trace 付加**: `merge.request.payload.trace.autoSavePhase='readonly'` で送信し、`merge.result.trace.events` に `lock.pending` → `lock.released` が記録されること。
- **threshold 上書き**: `payload.threshold=0.9` でリクエストし、`merge.result.result.profile.threshold` が 0.9 に一致しない場合に `merge.threshold.invalid` エラーを通知すること。
- **衝突時 UI トリガ**: `merge.result.result.hunks` に `decision='conflict'` が含まれる場合、`DiffMergeView` ストアが `ReadOnly` バナーと衝突バナーを同時に提示し、テレメトリ `merge:queue:resolved` に `retryable` が反映されること。【F:docs/design/merge/diff-merge-view.md†L85-L154】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L55-L152】

## 4. メッセージ時系列・エラー分類・テレメトリ送出条件

### 4.1 時系列
1. Webview (`DiffMergeView`) が `merge.request` を送信し、`reqId` と `payload.trace` で操作文脈を保存。【F:docs/src-1.35_addon/API-CONTRACT-EXT.md†L33-L86】
2. Extension 側 Merge Hub が AutoSave 共有ロックを要求し、待機イベントを `trace.events` に積む。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L55-L132】
3. `merge3` 実行後、`merge.result` を返却。`ok=false` 時はエラー分類を付与し、`trace.telemetry` に最新 AutoSave 状態をバインドする。【F:docs/src-1.35_addon/MERGE.md†L1-L25】【F:docs/design/merge/diff-merge-view.md†L124-L206】
4. Webview は結果を DiffMergeView ストアへ反映し、必要に応じて `queueMergeCommand` → `AutoSave.flushNow()` をトリガ。【F:docs/IMPLEMENTATION-PLAN.md†L56-L164】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L55-L152】

### 4.2 エラー分類

| コード | 代表シナリオ | Retryable | UI 表示 | テレメトリ |
| --- | --- | --- | --- | --- |
| `merge.threshold.invalid` | `payload.threshold` が 0–1 以外 | false | OperationPane で入力エラー表示、Diff タブ維持 | `merge:queue:resolved` (`retryable=false`)。【F:docs/src-1.35_addon/MERGE.md†L7-L25】 |
| `merge.lock.timeout` | AutoSave 共有ロックが 5 秒超待機 | true | ReadOnly バナー + リトライ CTA | `autosave.lock.warning` + `merge:queue:resolved` (`retryable=true`)。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L55-L152】 |
| `merge.unexpected` | マージ器内部例外 | false | Diff タブを `Compiled` にフォールバック | `merge:queue:resolved` (`retryable=false`) + Collector incident。【F:Day8/docs/day8/design/03_architecture.md†L1-L36】 |

### 4.3 テレメトリ送出条件
- `merge:tabs:change`: precision が `beta/stable` で Diff タブが表示された瞬間。`trace.telemetry.collectorSurface='diff-merge.tab'` をセット。【F:docs/design/merge/diff-merge-view.md†L124-L206】
- `merge:queue:enqueue`: `merge.request` 送信直後に発火し、`payload.trace.originTab` と AutoSave 状態をタグ化。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L55-L152】
- `merge:queue:resolved`: `merge.result` 受信時。`retryable` を `error?.retryable ?? true` で算出し Analyzer KPI を更新。【F:Day8/docs/day8/design/03_architecture.md†L1-L36】
- `autosave.lock.*`: AutoSave ランナーがロック状態を変化させた際に DiffMergeView と共有。Merge Bridge は `trace.events` を通じてエビデンスを残し、Collector パイプラインへ JSONL 送信する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L55-L180】【F:Day8/docs/day8/design/03_architecture.md†L1-L36】

