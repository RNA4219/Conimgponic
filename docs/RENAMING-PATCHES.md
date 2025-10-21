
# 置換パッチ指針（安全置換）

> 注意: 安易な全文置換は "img" などの部分一致を誤爆します。**境界付き**ルールで行います。

## 文字列置換ルール
1. 表示名: `Imgponic` → `Conimgponic`（大小区別）
2. 識別子/パッケージ: `"name": "imgponic` → `"name": "conimgponic`
3. PWAタイトル: `<title>Imgponic` → `<title>Conimgponic`
4. README見出し: `# Imgponic` → `# Conimgponic`
5. Manifest: `"name": "Imgponic` → `"name": "Conimgponic"`, `"short_name": "Imgponic"` → `"short_name": "Conimg"`

## 置換対象ファイル（例）
- `package.json`, `index.html`, `public/manifest.webmanifest`, `README.md`
- `src/App.tsx`（ツールバー表示名）
- ドキュメント類（*.md）

## 置換しないもの
- OPFSディレクトリ名（`project/`, `runs/`）
- LocalStorage キー（移行期間は旧キー維持）
- APIエンドポイント/ポート

## 追加修正
- PWAインストール済み端末は、**再インストール**で名称更新。
