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

下表は [DATA-SCHEMA.md](./DATA-SCHEMA.md) のルート構成および `storyboard.json` スキーマを基準に、拡張がエクスポート時に満たすべき必須項目・保存先をまとめたもの。`runs/<ts>/` の `<ts>` はエクスポート要求時の ISO タイムスタンプで、AutoSave の履歴世代と競合しない値を採用する。

| フォーマット | 出力先パス | 元データ（DATA-SCHEMA 基準） | 必須フィールド / 含有要素 |
| --- | --- | --- | --- |
| Markdown | `runs/<ts>/shotlist.md` | `storyboard.json.scenes[]` | 各シーンを `### {id} {title}` 見出し＋本文（`desc`,`manual`,`notes`）に展開。`id` と `title` は必須、本文セクションは空文字を許容するがキー自体は欠落不可。|
| CSV | `runs/<ts>/shotlist.csv` | `storyboard.json.scenes[]` | 列順固定 `id,title,desc,manual,status,tone,durationSec,shot,take,slate`。`tone` は配列を `;` 連結で格納し、数値フィールド（`durationSec`,`shot`,`take`）は文字列化して欠損を許可しない。|
| JSONL | `runs/<ts>/shotlist.jsonl` | `storyboard.json.scenes[]` と `meta` | 各行は 1 JSON オブジェクト。`scenes[]` のフィールドを完全に写像し、`id`,`title`,`status`,`durationSec` は必須。`assets`,`ai` など任意フィールドは存在時に出力する。|
| Package Export | `<workspace>/.conimgponic/project/export/<name>.imgponic.json`（拡張側が `<name>` を決定） | `project/storyboard.json` と `runs/<ts>/meta.json` | 2 ファイルを `{ storyboard, meta }` として同梱。`storyboard.meta.apiVersion` と `meta.updatedAt` を保持し、`scenes[]` 配列を欠落させない。|

> Package Export は `history/<iso>.json` とは別ディレクトリで管理し、署名処理は v1.0 では不要。`export.result` で返却するパスは上記の正規化済みパスを用いる。
