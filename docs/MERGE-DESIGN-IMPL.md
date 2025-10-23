
# 精緻マージ 実装詳細

## 0) サマリ
### 対象API
- `merge3` は Base/Ours/Theirs の 3-way マージを行い、hunk リストと統合済みテキストを返す。
- `MergeInput` は 3種類のソーステキストと任意の事前区切りセクションを受け付ける。
- `MergeHunk` はセクションごとの決定（自動/衝突）と比較指標を提供する。
- `MergeProfile` はトークナイザ・粒度・しきい値・優先度を制御し、部分指定を許容する。

### 性能・受入基準
- `docs/IMPLEMENTATION-PLAN.md` の Phase B 要件に基づき、100 カット（事前セクション提供あり）で 5 秒以内に完了する。自動マージ率はラベル付きケースで 80%以上、再実行時に決定的な結果を返す。【F:docs/IMPLEMENTATION-PLAN.md†L141-L174】

### スコアリング手順概要
1. プロファイル解決で `threshold` と `prefer`、および `merge.precision` に起因する最小自動採択閾値を取得する。
2. セクションごとにトークナイズ（`tokenizer`）→ LCS 差分を実行し、Jaccard・Cosine 類似度を算出する。
3. 類似度の調和平均（`blended`）を計算し、`threshold` を下回る場合は競合として出力する。
4. `prefer` と lock 情報を優先適用したうえで決定を確定し、決定イベントを UI/Telemetry へ通知する。
5. 全処理で 5 秒 SLA を超過しそうな場合は早期中断（`MergeError`）とし、リトライ判定に備える。

### `src/lib/merge.ts` 公開エクスポート一覧
| 名称 | 種別 | シグネチャ / 型 | 備考 |
| --- | --- | --- | --- |
| `MergeProfile` | Type | `{ tokenizer: 'char'|'word'|'morpheme'; granularity: 'section'|'line'; threshold: number; prefer: 'manual'|'ai'|'none'; seed?: string }` | 既定: `{ tokenizer: 'char', granularity: 'section', threshold: 0.75, prefer: 'none' }` |
| `MergeInput` | Type | `{ base: string; ours: string; theirs: string; sections?: string[]; locks?: ReadonlyMap<string, MergePreference> }` | lock で manual/ai を強制指定 |
| `MergeHunk` | Type | `{ id: string; section: string | null; decision: 'auto'|'conflict'; similarity: number; merged: string; manual: string; ai: string; base: string; prefer: MergePreference }` | 類似度は 0〜1 |
| `MergeResult` | Type | `{ hunks: MergeHunk[]; mergedText: string; stats: MergeStats }` | `stats.processingMillis` を含む |
| `merge3` | Function | `(input: MergeInput, profile?: Partial<MergeProfile>) => MergeResult` | 決定的なマージと統計を返却 |

> **Note**: `src/lib/merge.ts` は現在未実装。上記は本ドキュメントに基づく公開 API 設計である。

## 1) 目的
- Base(前版) / Ours(Manual) / Theirs(AI) の3-way決定的マージ
- セクション（ラベル or 段落）単位で類似度により自動採用 or 衝突

## 2) プロファイル
```ts
type MergeProfile = {
  tokenizer: 'char'|'word'|'morpheme',   // 既定: 'char'（日本語安定）
  granularity: 'section'|'line',         // 既定: 'section'
  threshold: number,                     // 既定: 0.75
  prefer: 'manual'|'ai'|'none'           // lock未指定時のデフォ
}
```

### プロファイル仕様
- **デフォルト決定**: `prefer: 'none'` を起点とし、lock が存在しないセクションでは `similarity >= threshold` の場合 `auto` 採択。しきい値未満の場合は `conflict`。
- **閾値適用順序**: 1) セクションごとの lock（UI/外部入力）による強制決定 → 2) プロファイルの `prefer` に基づく候補決定 → 3) `similarity` と `threshold` による自動採択判定。前段が成立した場合、後続の評価はスキップ。
- **決定性確保**:
  - セクションは入力 `sections`、無い場合は検出した境界をキー化し、`section` ラベルで辞書順ソート。
  - 差分計算ではトークン列生成後に安定ソート（`localeCompare` with `'en'`、`numeric: true`）。
  - スコアリングで同率の場合は `prefer` の順序 (`manual` → `ai`) を固定し、`seed` は `hash(base + ours + theirs)` を用いるが deterministic hash のみ（乱数不使用）。
- **グローバル設定との連携**: `merge.precision` フラグで `threshold` の上下限を制約（例: precision=high → `min 0.8`）、`autosave.enabled` が true の場合はマージ結果保存時に証跡出力を強制。UI から渡される `MergeProfile` はグローバル設定を上書きしない。
- **フラグ適用**: Beta フラグ `features.merge.experimental` が false の場合、`prefer` を強制的に `'manual'` にリライトし安全側とする。

## 3) インタフェース
```ts
export type MergeInput = {
  base: string;
  ours: string;
  theirs: string;
  sections?: string[];
  locks?: ReadonlyMap<string, MergePreference>;
};

export type MergeHunk = {
  id: string;
  section: string | null;
  decision: 'auto' | 'conflict';
  similarity: number;
  merged: string;
  manual: string;
  ai: string;
  base: string;
  prefer: MergePreference;
};

export interface MergeStats {
  autoDecisions: number;
  conflictDecisions: number;
  averageSimilarity: number;
  processingMillis: number;
}

export function merge3(
  input: MergeInput,
  profile?: Partial<MergeProfile>,
): { hunks: MergeHunk[]; mergedText: string; stats: MergeStats }
```

### UI 通知インターフェース
- `MergeDecisionEvent`: `merge:auto-applied`（自動確定）／`merge:conflict-detected`（競合提示）を publish。
- `MergeEventHub.subscribe(listener)` で UI が購読し、`DiffMergeView` がハンクごとのバッジとトーストを同期する。
- `retryable=true` の競合は UI 上で再試行ボタンを表示し、`queueMergeCommand` から再評価を依頼する。

## 4) アルゴリズム
1) セクション分割 → ラベル（`[主語]...`）の行を優先。無ければ空行で段落化
2) 各セクションで LCS 差分 → 類似度（Jaccard/Cosine簡易）
3) `similarity ≥ threshold` → **auto**。`lock`/`prefer` を反映
4) 未満 → **conflict** として両案を保持
5) 連続autoは連結。出力は決定的（乱数・時刻不使用）

### 4.1 スコアリング手順
| 手順 | 入力 | 出力 | SLA 対応 |
| --- | --- | --- | --- |
| 1. `resolveProfile` | `MergeProfile` + グローバル precision | `ResolvedMergeProfile` (`minAutoThreshold` = max(profile.threshold, precision.min)) | precision=beta/stable で最低 0.75 を担保 |
| 2. `tokenizeSection` | セクションテキスト | `MergeScoringInput` | トークンキャッシュで 100 カット処理を 5s 以内に維持 |
| 3. `score` | `MergeScoringInput`, `ResolvedMergeProfile` | `MergeScoringMetrics`（Jaccard, Cosine, blended） | `AbortSignal` 監視で SLA 超過前に打ち切り |
| 4. `decide` | `MergeScoringMetrics`, lock/prefer | `MergeDecision`, `similarity` | `similarity<minAutoThreshold` を必ず競合へフォールバック |
| 5. `emitDecision` | `MergeDecision`, `MergeHunk` | UI/Telemetry へのイベント | `merge:auto-applied`/`merge:conflict-detected` を 1 ハンク ≤1ms で送信 |

### 4.2 precision 別スコアリングと UI プロトコル

`merge.precision` フラグは `resolveProfile()` と `MergeScoringStrategy` の両方に影響する。下表は `src/lib/merge.ts` の `ResolvedMergeProfile` へ反映される閾値と、`docs/IMPLEMENTATION-PLAN.md` §0.3 のタブ制御を同期させた UI プロトコルである。

| precision | `minAutoThreshold` | `similarityBands.auto` / `review` | `score()` の重み | UI 反映 | Telemetry |
| --- | --- | --- | --- | --- | --- |
| `legacy` | `max(profile.threshold, 0.65)` | `auto=profile.threshold+0.08`, `review=profile.threshold-0.04` | `blended = 0.5*jaccard + 0.5*cosine` | Diff タブ非表示、`pref` は `manual-first`/`ai-first` のみ。【F:docs/IMPLEMENTATION-PLAN.md†L56-L70】 | `merge:finish` で従来統計のみ送信。 |
| `beta` | `max(profile.threshold, 0.75)` | `auto=clamp(profile.threshold+0.05, 0.8, 0.92)`, `review=profile.threshold-0.02` | `blended = 0.4*jaccard + 0.6*cosine` | Diff タブを末尾追加し `Beta` バッジとバックアップ CTA を表示。`queueMergeCommand('auto-apply')` 成功時に AutoSave `flushNow()` を要求。【F:docs/MERGEDOCK-FLAG-DESIGN.md†L97-L105】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L1-L63】 | `merge.precision.suggested` に `confidence_score=blended` を含め Analyzer が Phase B-0 SLO を算出。【F:docs/IMPLEMENTATION-PLAN.md†L246-L257】 |
| `stable` | `max(profile.threshold, 0.82)` | `auto=clamp(profile.threshold+0.03, 0.86, 0.95)`, `review=profile.threshold-0.01` | `blended = 0.3*jaccard + 0.7*cosine + historyBoost` (`historyBoost≤0.05`) | Diff タブを初期選択。ハンク確定時に `merge:lastTab=diff` を保持し、AutoSave 成功時刻が 5 分超過なら CTA を常時表示。【F:docs/IMPLEMENTATION-PLAN.md†L74-L90】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L1-L63】 | `merge.precision.blocked` を `retryable` 区分付きで Collector→Analyzer→Reporter へ伝搬し、Phase B-1 の SLO 監視を行う。【F:Day8/docs/day8/design/03_architecture.md†L1-L29】 |

`historyBoost` は AutoSave 履歴（直近 5 世代の差分）から抽出したハンク安定度スコアで、`autosave.enabled=true` の場合のみ最大 0.05 を加算する。AutoSave が無効または履歴不足時は 0 とし、後方互換性を保つ。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L1-L120】

UI 層は `precision` に応じて以下のプロトコルを実装する。

1. `legacy`: `DiffMergeView` をマウントせず、`merge:auto-applied` イベントは `MergeDock` の従来 UI で処理する。
2. `beta`: `merge:hunk-decision` イベントのたびに `uiSurface='diff-review'` を Collector へ送信し、ハンク承認後に AutoSave `flushNow()` を非同期実行する。
3. `stable`: `OperationPane` で `queueMergeCommand('commit-hunk')` 成功後に `merge:finish` をフックし、`Diff` タブへフォーカスを戻す。ロールバック時（precision→`legacy`）は `merge.lastTab` を `overview` へ更新し Diff ステートを破棄する。【F:docs/IMPLEMENTATION-PLAN.md†L59-L90】

Collector→Analyzer→Reporter のフローでは、`merge.precision` ごとに `merge_auto_success_rate` を分解集計し、フェーズ移行のゲートとして活用する。【F:Day8/docs/day8/design/03_architecture.md†L1-L29】【F:docs/IMPLEMENTATION-PLAN.md†L141-L164】

## 5) UI / Diff Merge インタラクション

### 5.1 コンポーネントツリー

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

| ノード | 説明 | 関連モジュール | precision 依存 | AutoSave 協調 |
| --- | --- | --- | --- | --- |
| `MergeDock` | precision 切替に応じてタブ構成と初期タブを決定。 | `src/components/MergeDock.tsx` | `legacy` で Diff タブ非表示。 | AutoSave 独占ロック時にタブ遷移を抑止。 |
| `DiffMergeView` | Diff タブ本体。ハンク状態・ロック状態のストアを保持。 | `src/components/DiffMergeView.tsx` | `beta/stable` でマウント。 | `locks.onChange` を購読し CTA 表示を制御。 |
| `HunkListPane` | ハンク一覧 + フィルタ。仮想スクロールで 100 件超を扱う。 | `DiffMergeView.tsx` 内部 | `legacy` 非表示。 | AutoSave ロック中は `aria-disabled`。 |
| `OperationPane` | 選択ハンクの詳細操作。 | `DiffMergeView.tsx` 内部 | `beta/stable`。 | AutoSave ロック中はボタン無効。 |
| `BannerStack` | バナー/トーストの集中管理。 | `DiffMergeView.tsx` 内部 | 全 precision | `retryable` エラーとロック通知を表示。 |
| `TelemetryBridge` | `queueMergeCommand` 発行とイベント購読を一元化。 | `src/lib/merge.ts` | 全 precision | AutoSave `flushNow()` 呼び出し順序を保証。 |

### 5.2 ハンク状態機械

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

| 状態 | UI 表示 | 主トリガー | Exit 条件 | precision 影響 | AutoSave 影響 |
| --- | --- | --- | --- | --- | --- |
| `Unloaded` | Diff ペイン非表示。 | `precision` が `beta/stable` に遷移。 | `queueMergeCommand('hydrate')` | `legacy` 中は維持。 | ロック無し。 |
| `Hydrating` | スケルトン + CTA ローディング。 | 初回フェッチ。 | `commandResolved(success/error)` | 全 precision | AutoSave ロック待ち表示を併用。 |
| `Ready` | ハンク一覧 + 操作バー有効。 | フェッチ成功。 | `selectHunk`, `autosave.lock`, `commandResolved`. | `beta/stable` | 共有ロック中は CTA disable。 |
| `Inspecting` | ハンク詳細強調。 | `selectHunk`. | `openBulk`, `openEditModal`, `commandResolved`. | `beta/stable` | ロック中は編集非表示。 |
| `Editing` | 編集モーダル + focus trap。 | `openEditModal`. | `closeModal`, `commandResolved`. | `stable` 初期表示 | AutoSave 独占ロック時は入力禁止。 |
| `BulkSelecting` | 一括操作バー固定。 | `openBulk`. | `bulkResolved`, `closeBulk`. | `stable` 主対象 | ロック中は enqueue のみ。 |
| `ReadOnly` | 「保存中…」バナー + CTA 非活性。 | AutoSave `locks.isShared('project')`。 | `autosave.release('project')`. | `beta/stable` | shared lock 解除で `Ready` 復帰。 |
| `Error` | 警告バナーとリトライ CTA。 | `commandResolved(error)`. | `retryCommand`. | 全 precision | `retryable` フラグで AutoSave 再試行と同期。 |

### 5.3 `queueMergeCommand` フロー

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
        Hub->>Hub: resume queued commands
        Hub-->>UI: commandResolved({ status, retryable })
    end
    UI->>AutoSave: flushNow() (success && precision in {beta,stable})
```

| 手順 | 詳細 | precision 影響 | AutoSave 協調 | リスク緩和 |
| --- | --- | --- | --- | --- |
| 1. enqueue | UI から `queueMergeCommand` を発行し、`payload` をストアにバッファ。 | 全 precision | ロック中は enqueue のみ許可。 | `merge.lastTab` に状態保存。 |
| 2. lock 交渉 | `merge.ts` が AutoSave 共有ロックを取得。 | `legacy` はスキップ。 | `lockPending` 時に UI へローディングバナーを表示。 | 5 秒超過で `retryable` エラー。 |
| 3. 実行 | ロック取得後に `merge3` または従来処理を呼び出す。 | `beta/stable` で Diff ハンク更新。 | AutoSave ロック解除までは結果適用を遅延。 | 失敗時は `retryable` 判定で UI リトライ。 |
| 4. 結果通知 | `commandResolved` を発火し UI ステータス更新。 | 全 precision | `retryable=false` で `MergeDock` を `compiled` へ戻す。 | Diff ステート破棄で不整合防止。 |
| 5. AutoSave flush | 成功時に `flushNow()` を連携。 | `beta/stable` のみ | ロック解除直後に実行。 | Telemetry でロック時間を追跡。 |

### 5.4 precision 切替とロック協調

| 遷移 | タブ制御 | ハンク状態 | AutoSave 要件 | ロールバック |
| --- | --- | --- | --- | --- |
| `legacy → beta` | Diff タブを末尾に追加し `activeTab` を `compiled` に維持。 | `Unloaded` → `Hydrating`。 | 共有ロックで読み取りのみ許可。 | 失敗時はタブ非表示。 |
| `beta → stable` | Diff タブを初期表示に昇格。 | `Ready` を初期状態とし `BulkSelecting` を許可。 | AutoSave `flushNow()` を強制呼び出し。 | AutoSave ロック超過時は `beta` へ戻す。 |
| `stable → beta` | Diff 特有 CTA を DOM から除去。 | `BulkSelecting` を終了させ `Ready` に戻す。 | AutoSave 独占ロック中は遷移禁止。 | 未完了コマンドをキャンセル。 |
| `beta → legacy` | Diff タブを非表示にし `activeTab` を `compiled` にフォールバック。 | `ReadOnly` / `Error` 状態を破棄。 | `releaseShared('project')` を送信。 | Diff 状態と Telemetry キューを消去。 |

- Phase ガード表は `PRECISION_PHASE_GUARD` として実装され、precision ごとの初期タブ・露出順序を `DiffMergeView.planDiffMergeSubTabs` で固定化する。Phase A (`legacy`) では Review タブのみを許容し、Phase B (`beta`/`stable`) は Diff/Merged/Review の順序を Day8 パイプライン集計と合わせる。【F:src/components/DiffMergeView.tsx†L25-L52】【F:Day8/docs/day8/design/03_architecture.md†L3-L27】
- 拡張ブリッジは `createVsCodeMergeBridge` を介し、VS Code 設定 `conimg.merge.threshold` を core へ上書き伝搬する。`merge.precision` 切替と同時にハンドラが `MergeProfile.threshold` をクランプし、AutoSave 設計のフラグ協調要件（共有ロック/flushNow 手順）と矛盾しないようにする。【F:src/platform/vscode/merge/bridge.ts†L1-L67】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L61-L209】
- `MergeTrace.summary` に `threshold` と `autoAdoptionRate` を追加し、Collector で自動採用率 80% 監視を行う。trace.decisions には各ハンクの `decision` と `similarity` を保持し、Analyzer が Phase B ガード判定を再現できる。【F:src/lib/merge.ts†L204-L237】【F:docs/design/extensions/telemetry.md†L24-L35】

### 5.5 テスト & ロールバック観点
- React テスト (`tests/merge/diff-merge-view.spec.ts`) ではタブキーボード操作・バナー表示・`queueMergeCommand` フロー・AutoSave ロック遷移を網羅する。【F:docs/design/merge/diff-merge-view.md†L91-L154】
- リスクシナリオは AutoSave ロック解除遅延・precision 降格・`retryable=false` エラーで Diff タブをロールバックする条件を維持する。【F:docs/design/merge/diff-merge-view.md†L157-L175】

## 6) 決定プロセスと通知
1. `merge3` 開始時に `telemetry('merge:start')` を送信し、`sceneId` と `ResolvedMergeProfile` を Collector に記録。
2. 各ハンク決定後に `MergeEventHub.publish` を実行し、UI へ `merge:auto-applied` または `merge:conflict-detected` を通知。競合は `retryable` フラグで再評価可否を示す。
3. 競合が再評価でも解消しない場合はバックオフを 3 段階で適用し、UI はステータスバナーを表示する。
4. 全ハンクが処理されたら `telemetry('merge:finish')` を送信し、`MergeStats`（auto/conflict 件数、平均類似度、処理時間）を証跡へ残す。

## 7) アルゴリズム最適化と Telemetry/TDD
- **最適化方針**: セクション分割キャッシュとトークン再利用で O(n) に近いスループットを確保。100 カットの 5 秒 SLA を守るため、LCS の計測対象をセクション長 2,048 トークン以下に制限し、超過時はサブセクション化する。
- **テレメトリ計測ポイント**: `merge:start`（入力件数, precision）、`merge:hunk-decision`（ハンクID, similarity, decision, latency）、`merge:finish`（総処理時間, 自動採択率）。Collector へは `merge.*` JSONL チャネルで送信し、Analyzer が SLO 指標を算出する。【F:docs/IMPLEMENTATION-PLAN.md†L160-L164】
- **TDD ケース**:
  - `merge.precision='legacy'` で Diff Merge タブが隠れる UI 判定。【F:docs/IMPLEMENTATION-PLAN.md†L153-L156】
  - `merge.precision='beta'|'stable'` で自動マージ率が 0.8 を下回る場合に競合へフォールバックする統計検証。
  - 競合イベントが UI に伝搬し、`retryable=true` で再評価が可能であること。
  - Telemetry が `merge:start` → `merge:hunk-decision` → `merge:finish` の順に送信され、Collector スキーマ互換を保つ。
6. すべてのログに `sceneId`, `section`, `ts`, `userId` を含め、Reporter 側の propose-only 原則に従って Git への自動書き込みは行わない。

### 5.7 `merge.ts` I/O パターン整理

#### 5.7.1 API・入出力一覧
| API | 主入力 | 主出力 | 副作用 | 参考 | 備考 |
| --- | --- | --- | --- | --- | --- |
| `merge3(input, profile?)` | `MergeInput` (`base`/`ours`/`theirs`/`sections?`) | `{ hunks, mergedText, stats }` | なし（純関数） | 【F:docs/MERGE-DESIGN-IMPL.md†L16-L110】 | フラグ `merge.precision` に応じた閾値適用を前提。 |
| `queueMergeCommand(cmd)` | `MergeCommand`（`setManual`/`setAI`/`commitManualEdit` など） | `Promise<void>` | `store.ts` 経由で `Scene.manual` 更新、`merge:trace:*` ログ発火 | 【F:docs/MERGE-DESIGN-IMPL.md†L170-L205】 | AutoSave ロックとの協調が必須。 |
| `subscribeMergeEvents(listener)` | `listener(event)` | `unsubscribe()` | コマンド適用結果・統計更新を publish | 【F:docs/MERGE-DESIGN-IMPL.md†L170-L205】 | DiffMergeView がハンク再描画に利用。 |
| `persistMergeTrace(hunks, stats)` | ハンク配列・統計 | `Promise<TraceMeta>` | `runs/<ts>/merge.json` へ書込、Collector へ `merge:trace:*` | 【F:docs/MERGE-DESIGN-IMPL.md†L205-L222】 | AutoSave と同じ OPFS 安全策を適用。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L3-L132】 |

#### 5.7.2 AutoSave API との整合ポイント
- AutoSave の `initAutoSave` は `snapshot` / `flushNow` / `dispose` を提供するため、`queueMergeCommand` 適用後に `flushNow` を遅延トリガし `current.json` / `index.json` の整合を維持する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L3-L132】
- `AutoSaveError.retryable` 判定と Merge コマンドの再試行を整合させ、ロック未取得（`lock-unavailable`）は AutoSave の指数バックオフに合わせて再送する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L61-L180】
- AutoSave が `saved` を発火する前に `persistMergeTrace` が完了すると Collector 側の JSONL 整合が崩れるため、`subscribeMergeEvents` で AutoSave `saved` を待ってから `merge:trace:persisted` を出力する順序を固定する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L186-L318】【F:docs/MERGE-DESIGN-IMPL.md†L205-L222】

#### 5.7.3 主要テスト観点（事前リスト）
1. **純粋マージ結果**: `merge3` が `sections` 有無にかかわらず determinism を維持し、`stats.avgSim` が算出される。`prefer` 強制時の結果もスナップショット化する。【F:docs/MERGE-DESIGN-IMPL.md†L16-L110】
2. **コマンド適用と AutoSave 協調**: `queueMergeCommand` → `store.ts` 更新 → AutoSave `flushNow` → `persistMergeTrace` の順序が保証され、`AutoSaveError.retryable` ケースで再試行イベントが同期する。【F:docs/MERGE-DESIGN-IMPL.md†L170-L222】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L61-L209】
3. **Collector 連携**: `persistMergeTrace` 成功時に `merge:trace:persisted` が JSONL 出力され、失敗時は `merge:trace:error` で `retryable` フラグを明示し Day8 パイプラインへ通知する。【F:docs/MERGE-DESIGN-IMPL.md†L205-L222】【F:Day8/docs/day8/design/03_architecture.md†L3-L27】

## 8) 証跡
- `runs/<ts>/merge.json` に hunkごとの `{section, similarity, decision}` を記録
- `meta.json` に `merge_profile` を追記

### JSON Schema
#### `runs/<ts>/merge.json`
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "MergeRun",
  "type": "object",
  "properties": {
    "run_id": { "type": "string", "pattern": "^\\d{8}T\\d{6}Z$" },
    "profile": {
      "type": "object",
      "properties": {
        "tokenizer": { "enum": ["char", "word", "morpheme"] },
        "granularity": { "enum": ["section", "line"] },
        "threshold": { "type": "number", "minimum": 0, "maximum": 1 },
        "prefer": { "enum": ["manual", "ai", "none"] }
      },
      "required": ["tokenizer", "granularity", "threshold", "prefer"],
      "additionalProperties": false
    },
    "hunks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "section": { "type": ["string", "null"] },
          "decision": { "enum": ["auto", "conflict"] },
          "similarity": { "type": "number", "minimum": 0, "maximum": 1 },
          "merged": { "type": "string" },
          "manual": { "type": "string" },
          "ai": { "type": "string" }
        },
        "required": ["section", "decision"],
        "additionalProperties": false
      }
    },
    "stats": {
      "type": "object",
      "properties": {
        "auto": { "type": "integer", "minimum": 0 },
        "conflicts": { "type": "integer", "minimum": 0 },
        "avgSim": { "type": "number", "minimum": 0, "maximum": 1 }
      },
      "required": ["auto", "conflicts", "avgSim"],
      "additionalProperties": false
    }
  },
  "required": ["run_id", "profile", "hunks", "stats"],
  "additionalProperties": false
}
```

#### `runs/<ts>/meta.json`
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "MergeMeta",
  "type": "object",
  "properties": {
    "merge_profile": {
      "type": "object",
      "properties": {
        "tokenizer": { "enum": ["char", "word", "morpheme"] },
        "granularity": { "enum": ["section", "line"] },
        "threshold": { "type": "number", "minimum": 0, "maximum": 1 },
        "prefer": { "enum": ["manual", "ai", "none"] }
      },
      "required": ["tokenizer", "granularity", "threshold", "prefer"],
      "additionalProperties": false
    },
    "stats": {
      "type": "object",
      "properties": {
        "auto": { "type": "integer", "minimum": 0 },
        "conflicts": { "type": "integer", "minimum": 0 },
        "avgSim": { "type": "number", "minimum": 0, "maximum": 1 }
      },
      "required": ["auto", "conflicts", "avgSim"],
      "additionalProperties": false
    }
  },
  "required": ["merge_profile", "stats"],
  "additionalProperties": false
}
```

### Collector への影響
- `MergeRun` は Collector の JSONL 取り込み対象外であり、個別ファイルとして保存されるが、Analyzer 連携のため `run_id` を `meta.json` と一致させる。
- Collector は `stats.auto`, `stats.conflicts`, `stats.avgSim` を抽出し、Day8 Analyzer のメトリクス `pass_rate` に相当する `auto_rate` を計算するよう拡張が必要。
- 既存の JSONL 契約には影響せず、Reporter は `meta.json` の `merge_profile` を参照して結果コメントに反映する。

## 9) 性能目標
- 100カットで ≤5秒（セクションあり、charトークン）
- 必要に応じ **Web Worker** 化（後段）

## 10) 受入
- ラベル付きで自動マージ率 ≥80%
- 再実行で同一結果（決定性）
- lock=manual/ai の優先が反映される

## 11) エッジケースと Test Matrix
### エッジケース
- **セクション欠如**: 入力にセクションラベルが無い場合、空行で段落抽出し `section` を連番付与。
- **文字コード差**: Base/Ours/Theirs のエンコーディングが混在する場合は UTF-8 へ正規化し、不可視差分を正規化（NFC）。
- **空入力**: いずれかが空文字の場合、他のテキストを `auto` として採用し、`similarity` を 0 とする。
- **不正プロファイル**: 許容外のトークナイザや閾値が渡された場合は `MergeProfileValidationError` を投げる。
- **トークナイザ未対応**: ブラウザで形態素分割が利用不可の場合、`tokenizer` を `'char'` にフォールバックし Warning を記録。

### Test Matrix（TDD 指針）
| Case | 入力条件 | 期待結果 | テスト戦略 | モック |
| --- | --- | --- | --- | --- |
| T1 | セクションラベル有り、`similarity` 高 | `auto` 連結、`avgSim` > threshold | node:test で `merge3` 単体 | トークナイザをスタブし固定トークン返却 |
| T2 | ラベル無し、空行分割 | 連番セクション、決定的順序 | node:test でセクション検出検証 | `detectSections` を spy しソート順確認 |
| T3 | lock=manual 指定 | lock を優先し `prefer`/threshold 無視 | node:test で lock 優先度確認 | `decide` 内部で lock 処理をモック |
| T4 | `prefer='ai'`, similarity 下回り | `conflict` 判定維持 | node:test でしきい値制御 | スコアラーを固定値返却にモック |
| T5 | 不正プロファイル（threshold=1.5） | `MergeProfileValidationError` 発火 | node:test で例外検証 | バリデーション関数を直接呼ぶ |
| T6 | トークナイザ未対応 | `'char'` フォールバック + Warning | node:test で fallback | 外部 tokenizer モジュールを `throws` で差し替え |
| T7 | 空入力（theirs 空） | ours を auto 採択 | node:test で空文字処理 | スコアリングを 0 返却にモック |
| T8 | 文字コード差（NFD/NFC） | 正規化後に同一判定 | node:test で normalization | `normalizeText` をモックし呼び出し検証 |

## 12) Analyzer/Reporter 連携チェックリスト
- [ ] Collector が `runs/<ts>/merge.json` を検知し、`auto_rate = auto / (auto + conflicts)` を算出できる。
- [ ] Analyzer が `avgSim` を `metrics.duration_p95` と同列に扱えるよう型を拡張済み。
- [ ] Reporter の Why-Why 草案が `merge_profile.prefer` を参照し、意図した判断理由を記述できる。
- [ ] `reports/today.md` に `auto/conflict` の推移グラフを追加するパイプラインが整備済み。
- [ ] `workflow-cookbook/scripts/analyze.py` が `MergeMeta` を JSON Schema に沿ってバリデーションする。
- [ ] Day8 ドキュメントに記載された JSONL ログとの互換性を保つため、`MergeRun` は JSONL 化せず別ファイルとして扱う運用が共有されている。
