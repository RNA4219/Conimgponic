
# 精緻マージ 実装詳細

## 1) 目的
- Base(前版) / Ours(Manual) / Theirs(AI) の3-way決定的マージ
- セクション（ラベル or 段落）単位で類似度により自動採用 or 衝突

## 2) プロファイル
```ts
type MergeProfile = {
  tokenizer: 'char'|'word'|'morpheme',   // 既定: 'char'（日本語安定）
  granularity: 'section'|'line',         // 既定: 'section'
  threshold: number,                      // 既定: 0.75
  prefer: 'manual'|'ai'|'none'            // lock未指定時のデフォ
}
```

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

## 5) UI
- `MergeDock` に **Diff Merge** タブ
- セクション：自動採用（薄緑）／衝突（黄色）
- 衝突ごとに「Manual採用」「AI採用」「手動編集」
- 一括操作：しきい値スライダー、全Manual/全AI
- 「結果を採用」→ `Scene.manual` に書き戻し（既存フローと互換）

## 6) 証跡
- `runs/<ts>/merge.json` に hunkごとの `{section, similarity, decision}` を記録
- `meta.json` に `merge_profile` を追記

## 7) 性能目標
- 100カットで ≤5秒（セクションあり、charトークン）
- 必要に応じ **Web Worker** 化（後段）

## 8) 受入
- ラベル付きで自動マージ率 ≥80%
- 再実行で同一結果（決定性）
- lock=manual/ai の優先が反映される
