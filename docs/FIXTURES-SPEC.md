
# ゴールデン・テストフィクスチャ仕様

## 1. 目的
- コンパイル結果（MD/CSV/JSONL）の**再現性**を継続検証する。
- AutoSave/精緻マージ/Import/Export 変更による**回帰**を早期検出する。

## 2. フォルダ構成（例）
```
tests/fixtures/
  case-mini-03/
    project.storyboard.json   # 入力：Storyboard
    expected.md               # 期待：Compiled MD（正規化前テキスト）
    expected.csv              # 期待：CSV（UTF-8, ヘッダ有）
    expected.jsonl            # 期待：JSONL（1行=1カット）
    notes.md                  # 用途/意図/境界値メモ
  case-merge-10/
    project.storyboard.json
    expected.md
    expected.csv
    expected.jsonl
    notes.md
manifest.json                 # フィクスチャ一覧（メタ: 難易度/タグ）
```

## 3. Storyboard 入力（必須フィールド）
- `id, title, scenes[], version, selection[]`
- `Scene`: `id, manual, ai, status, seed?, tone?, lock?, assets[]`
- **注**: v1.4拡張 `slate, shot, take` は任意。存在すれば出力にも反映。

## 4. 正規化規則（比較時）
- 改行：CRLF→LF、末尾連続改行は1つに圧縮
- 空白：連続スペース→1つ、行末スペース削除
- CSV：クォートは `"`、改行は `\n` エスケープ、UTF-8、ヘッダ固定
- JSONL：各行は厳密JSON、順序は `index` 昇順

## 5. 判定
- **厳密一致**（MD/CSV/JSONLすべて一致）を基本とする
- 実装差異が不可避の環境では **許容誤差**として「空白差/行頭行末の空行」は無視

## 6. 最小ケース推奨
- `case-mini-03`：3カット（manual/ai混在、tone/seedあり）
- `case-merge-10`：10カット（ラベル区切り＆一部衝突を意図的に含む）
- `case-shot-meta`：slate/shot/take を全面使用

## 7. manifest.json フォーマット
```json
{
  "version": 1,
  "cases": [
    { "id": "case-mini-03", "tags": ["smoke","compile"], "cuts": 3 },
    { "id": "case-merge-10", "tags": ["merge","conflict"], "cuts": 10 }
  ]
}
```

## 8. 運用
- 新機能追加時は**最小差分**でケースを追加
- ゴールデン更新は**レビュー必須**（差分をPRで確認）
