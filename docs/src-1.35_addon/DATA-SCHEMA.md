# DATA-SCHEMA — データモデル

## 1. ルート構成（PWA既定）
```
<workspace>/.conimgponic/
  project/
    storyboard.json
    templates.json
    assets.json
  runs/<ts>/
    shotlist.md
    shotlist.csv
    shotlist.jsonl
    meta.json
    merge.json
  history/<iso>.json
  state.json
```

### 1.1 エクスポート成果物の割当

| ディレクトリ | 拡張が書き込むファイル | 由来データ | 補足 |
| --- | --- | --- | --- |
| `runs/<ts>/` | `shotlist.md` / `shotlist.csv` / `shotlist.jsonl` / `meta.json` | `project/storyboard.json` の `scenes[]` と `meta` | `<ts>` は Export Bridge が生成する ISO タイムスタンプ。AutoSave の GC と衝突しないよう `project/.lock` を保持した状態で `fs.atomicWrite` を実行。|
| `project/export/` | `<name>.imgponic.json` | `project/storyboard.json` と `runs/<ts>/meta.json` | エクスポートリクエスト毎に `<name>` を拡張が決定。`history/<iso>.json` には書き込まない。|

## 2. storyboard.json（抜粋）
```json
{
  "meta": {
    "apiVersion": "1.0.0",
    "generator": "Conimgponic v1.0",
    "createdAt": "2025-10-23T12:00:00Z",
    "updatedAt": "2025-10-23T12:34:56Z"
  },
  "scenes": [
    {
      "id": "scn_001",
      "title": "オープニング",
      "desc": "全景から主人公の背中",
      "manual": "主人公の歩み…",
      "ai": "（v1.0ではmock）",
      "status": "draft",
      "tone": ["calm","morning"],
      "durationSec": 5.5,
      "assets": ["ref/scene1.jpg"],
      "shot": 1,
      "take": 1,
      "slate": "A001"
    }
  ]
}
```

## 3. JSON Schema（要点）
- `meta.apiVersion`: string（semver）
- `scenes[].id`: string（一意）
- `scenes[].status`: enum（draft/need_ai/review/locked）
- `scenes[].durationSec`: number（>=0）
- 空文字許可（`ai`など）。NULLは原則使わない。
