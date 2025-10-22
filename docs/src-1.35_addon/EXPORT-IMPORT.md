# EXPORT-IMPORT — 出力/取り込み仕様

## 1. Markdown（shotlist.md）
- 1行=1カット。`### {id} {title}` の見出し＋本文（desc/manual/notes）。
- 改行正規化: LF、末尾空行1つ。

## 2. CSV（shotlist.csv）
- 文字コード: UTF-8（BOMなし）
- 区切り: `,`、改行: `\n`
- エスケープ: `"` を `""` に二重化、フィールドは必要時のみ `"` で囲む
- 列: `id,title,desc,manual,status,tone,durationSec,shot,take,slate`

## 3. JSONL（shotlist.jsonl）
- 1行に1 JSON オブジェクト。
- フィールドは `storyboard.json` の `scenes[]` と同等。

## 4. Package Export（.imgponic.json）
- `project/storyboard.json` と直近の `runs/<ts>/meta.json` を1ファイルにまとめる。
- 署名は行わない（v1.0）。

## 5. 正規化ルール（共通）
- 行末: LF 統一、末尾空白の除去。
- 連続空行は最大1。
