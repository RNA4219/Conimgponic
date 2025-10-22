
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

## 5) UI / インタラクション
### Algorithm Details
#### 擬似コード
```pseudo
function merge3(input, profile):
  cfg = resolveProfile(profile)
  sections = detectSections(input, cfg.granularity)
  hunks = []
  stats = { auto: 0, conflicts: 0, sumSim: 0 }
  for section in sections sorted by section.key:
    tokens = tokenizeSection(section, cfg.tokenizer)
    diff = computeLCS(tokens.base, tokens.ours, tokens.theirs)
    similarity = score(diff, method="hybrid-jaccard-cosine")
    decision = decide(section.lock, cfg, similarity)
    hunk = assemble(section, decision, similarity)
    updateStats(stats, hunk, similarity)
    hunks.append(hunk)
  mergedText = concatAuto(hunks)
  stats.avgSim = stats.sumSim / max(1, len(hunks))
  return { hunks, mergedText, stats }
```

#### フローチャート
```mermaid
flowchart TD
  A[入力 MergeInput] --> B[セクション分割/キー生成]
  B --> C[トークナイズ & LCS差分]
  C --> D[類似度スコアリング]
  D --> E{lock / prefer?}
  E -->|lockあり| F[強制決定]
  E -->|lockなし| G{similarity >= threshold}
  G -->|Yes| H[auto 決定]
  G -->|No| I[conflict 保持]
  F --> J[Hunk生成]
  H --> J
  I --> J
  J --> K[連続auto連結]
  K --> L[統合結果 & 統計更新]
  L --> M[証跡出力 runs/<ts>/merge.json]
```

#### データフロー図
```mermaid
graph LR
  profile[MergeProfile] --> resolver(resolveProfile)
  resolver --> cfg[ResolvedProfile]
  input[MergeInput] --> splitter(detectSections)
  splitter --> sections[Sections]
  sections --> tokenizer[tokenizeSection]
  tokenizer --> diff[computeLCS]
  diff --> scorer[score]
  cfg --> decider(decide)
  scorer --> decider
  decider --> assembler(assemble)
  assembler --> hunks[Hunks]
  hunks --> concat(concatAuto)
  concat --> output[MergedText]
  hunks --> stats[Aggregate Stats]
  stats --> trace[runs/<ts>/merge.json]
  cfg --> trace
```

## 5) UI
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
