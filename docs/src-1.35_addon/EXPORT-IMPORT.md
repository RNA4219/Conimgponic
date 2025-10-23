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

## 6. フォーマット別 必須フィールドと出力先

| フォーマット | 出力先パス | 必須フィールド / 含有要素 |
| --- | --- | --- |
| Markdown | `runs/<ts>/shotlist.md` | `id`, `title`（見出し）、`desc`, `manual`, `notes` の本文セクション。|
| CSV | `runs/<ts>/shotlist.csv` | 列 `id,title,desc,manual,status,tone,durationSec,shot,take,slate` を順序固定で出力し、欠損不可。|
| JSONL | `runs/<ts>/shotlist.jsonl` | `storyboard.json` の `scenes[]` と同等フィールド（`id`,`title`,`desc`,`manual`,`status`,`tone`,`durationSec`,`shot`,`take`,`slate`,`assets` など）。|
| Package Export | `<workspace>/.conimgponic/project/export/<name>.imgponic.json`（拡張側で決定） | `project/storyboard.json` と直近の `runs/<ts>/meta.json` を同梱し、`meta`→`scenes[]` の完全構造を保持。|

> `DATA-SCHEMA.md` のルート構成に従い、`runs/<ts>/` は既存実行単位のタイムスタンプディレクトリを指す。Package Export は履歴管理 (`history/<iso>.json`) と衝突しない専用ディレクトリを用意し、署名処理は v1.0 では不要。
