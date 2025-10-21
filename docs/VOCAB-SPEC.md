
# 語彙テンプレ仕様（映画用語 / カメラ / ネガティブ）

## 1. 目的
- 生成プロンプトの**一貫性**を高め、スタイルのブレを削減。
- 精緻マージの自動採用率向上（セクション語彙の固定化）。

## 2. JSON スキーマ（論理）
```json
{
  "version": 1,
  "tokens": {
    "styles": { "cinematic": "…", "noir": "…", "anime": "…" },
    "camera": {
      "lens": { "wide": "24mm wide", "standard": "50mm", "tele": "85mm" },
      "motion": { "dolly": "dolly-in", "handheld": "handheld shake", "static": "locked-off" }
    },
    "lighting": { "high_key": "high-key", "low_key": "low-key", "rim": "rim light" },
    "negatives": {
      "avoid_generic": "avoid generic phrasing, be specific",
      "avoid_overexposure": "avoid blown highlights"
    }
  },
  "aliases": { "film_noir": "noir", "anime_style": "anime" },
  "locale": "ja-JP",
  "notes": "キーワード句。英語成分は生成モデルに合わせて保持可。"
}
```

## 3. 運用
- `project/templates.json`（ユーザー定義）と**マージ**可能な構造にする。
- 用語は**短文化**（最長80文字程度）。複合は `,` 区切り。
- バージョンは整数で上げる（破壊なし）。

## 4. カテゴリ最小セット
- `styles`: cinematic/noir/anime
- `camera.lens`: wide/standard/tele
- `camera.motion`: static/dolly/handheld
- `lighting`: high_key/low_key/rim
- `negatives`: 2〜5項目（禁止/抑制）

## 5. 品質ガイド
- 具体・観察可能・曖昧語回避。「美しい」「良い」等はNG。
- カメラと照明の**物理的記述**を優先（mm, 動作, 方向）。
- 日本語UIでも**英語トークン**を許可（モデル理解のため）。
