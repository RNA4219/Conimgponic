# PLUGIN-API — Conimg独自プラグイン v1

## 1. 配置
- `<workspace>/.conimgponic/plugins/<name>/conimg-plugin.json` + `index.js`。

## 2. マニフェスト
```json
{
  "name": "conimg-sample",
  "version": "0.1.0",
  "conimg-api": "1",
  "permissions": ["fs", "ui:widget"],
  "hooks": ["onCompile", "onExport", "commands"]
}
```

## 3. フック
- `onCompile(scene) -> scene`
- `onExport(ctx) -> {format, data}`
- `onMerge({base,ours,theirs}) -> {merged}`
- `commands: { [id]: (ctx) => any }`
- `widgets?: [{ id, mount(ctx, el) }]`

## 4. セキュリティ
- 既定は**無効**。個別に有効化。
- **権限明示**（`fs`/`ui:*`）。ネットは既定禁止。
- 実行は**WebWorker**（UI）／将来は拡張側ゲート（I/O）。
- タイムアウト/メモリ上限/例外は隔離。

## 5. 受入基準
- サンプルプラグインが **再起動なし**でロード／UIウィジェット表示。
