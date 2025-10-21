
# 精緻マージ 実装詳細

## 0) サマリ
### 対象API
- `merge3` は Base/Ours/Theirs の 3-way マージを行い、hunk リストと統合済みテキストを返す。
- `MergeInput` は 3種類のソーステキストと任意の事前区切りセクションを受け付ける。
- `MergeHunk` はセクションごとの決定（自動/衝突）と比較指標を提供する。
- `MergeProfile` はトークナイザ・粒度・しきい値・優先度を制御し、部分指定を許容する。

### 性能・受入基準
- 100カット想定で 5 秒以内に完了すること（char トークン、セクション提供時）。
- ラベル付きケースで自動マージ率 80%以上を達成すること。
- 再実行時に決定的な結果が得られ、lock/優先度設定が尊重されること。

### `src/lib/merge.ts` 公開エクスポート一覧
| 名称 | 種別 | シグネチャ / 型 | 備考 |
| --- | --- | --- | --- |
| `MergeProfile` | Type | `{ tokenizer: 'char'|'word'|'morpheme'; granularity: 'section'|'line'; threshold: number; prefer: 'manual'|'ai'|'none' }` | 既定: `{ tokenizer: 'char', granularity: 'section', threshold: 0.75, prefer: 'none' }` |
| `MergeInput` | Type | `{ base: string; ours: string; theirs: string; sections?: string[] }` | 事前分割セクションは任意 |
| `MergeHunk` | Type | `{ section: string | null; decision: 'auto'|'conflict'; similarity?: number; merged?: string; manual?: string; ai?: string }` | 類似度は 0〜1 |
| `merge3` | Function | `(input: MergeInput, profile?: Partial<MergeProfile>) => { hunks: MergeHunk[]; mergedText: string; stats: { auto: number; conflicts: number; avgSim: number } }` | 決定的なマージと統計を返却 |

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

## 6) 証跡
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

## 7) 性能目標
- 100カットで ≤5秒（セクションあり、charトークン）
- 必要に応じ **Web Worker** 化（後段）

## 8) 受入
- ラベル付きで自動マージ率 ≥80%
- 再実行で同一結果（決定性）
- lock=manual/ai の優先が反映される

## 9) エッジケースと Test Matrix
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

## 10) Analyzer/Reporter 連携チェックリスト
- [ ] Collector が `runs/<ts>/merge.json` を検知し、`auto_rate = auto / (auto + conflicts)` を算出できる。
- [ ] Analyzer が `avgSim` を `metrics.duration_p95` と同列に扱えるよう型を拡張済み。
- [ ] Reporter の Why-Why 草案が `merge_profile.prefer` を参照し、意図した判断理由を記述できる。
- [ ] `reports/today.md` に `auto/conflict` の推移グラフを追加するパイプラインが整備済み。
- [ ] `workflow-cookbook/scripts/analyze.py` が `MergeMeta` を JSON Schema に沿ってバリデーションする。
- [ ] Day8 ドキュメントに記載された JSONL ログとの互換性を保つため、`MergeRun` は JSONL 化せず別ファイルとして扱う運用が共有されている。
