# API-CONTRACT-EXT — VS Code 拡張向け API 契約（v1.0）

## 1. 目的と範囲
- **目的**: PWA UIを Webview に移植し、**postMessage** 経由で拡張ホストと通信するための**型・時系列・誤り処理**を固定。  
- **範囲**: `customEditor` 上での **ドキュメント編集/保存/履歴**、**精緻マージ**、**Export/Import**、**プラグインI/F v1**。`gen.*` は将来のLLM接続用の受け口のみ定義。

## 2. ランタイム前提（Webview）
- `acquireVsCodeApi()` を用いて state/push/pop を利用可。
- **CSP厳格**（`default-src 'none'`、`script-src 'nonce-...'`、styleは `nonce` or `unsafe-inline` 不可が望ましい）。
- 外部ネットワークへの fetch は**禁止**。ネットワークは**拡張側ゲート**を介す（将来）。

## 3. メッセージバス（基本）
- **封筒型**（Envelope）: すべてのメッセージに共通のヘッダを付与。
```ts
type MsgBase = {
  type: string              // 例: "snapshot.request"
  apiVersion: 1             // メッセージ契約のバージョン
  reqId?: string            // 要求→応答の相関ID（応答はreqIdをエコー）
  ts?: number               // epoch ms（送信側で付与）
}
```
- **相関**: 要求系は `reqId` を必須。応答は同一 `reqId` を返却。
- **エラー**: 応答系は `{ ok: false, error: { code, message, details? } }` を許容。

## 4. 型定義（抜粋）

### 4.1 Webview → Extension
```ts
type WvToExt =
  | ({ type: "ready" } & MsgBase & { payload: { uiVersion: string } })
  | ({ type: "snapshot.request" } & MsgBase & { payload: { doc: any } })
  | ({ type: "fs.read" } & MsgBase & { payload: { uri: string } })
  | ({ type: "fs.write" } & MsgBase & { payload: { uri: string, dataBase64: string } })
  | ({ type: "fs.list" } & MsgBase & { payload: { dir: string } })
  | ({ type: "fs.atomicWrite" } & MsgBase & { payload: { uri: string, dataBase64: string } })
  | ({ type: "merge.request" } & MsgBase & { payload: { base: any, ours: any, theirs: any, threshold?: number } })
  | ({ type: "export.request" } & MsgBase & { payload: { format: "md" | "csv" | "jsonl" } })
  | ({ type: "plugins.reload" } & MsgBase )
  | ({ type: "log" } & MsgBase & { payload: { level: "debug"|"info"|"warn"|"error", message: string } })
  | ({ type: "gen.request" } & MsgBase & { payload: { prompt: string, opts?: Record<string, any> } }) // 将来
```

### 4.2 Extension → Webview
```ts
type ExtToWv =
  | ({ type: "bootstrap" } & MsgBase & { payload: { doc: any, settings: Record<string, any>, flags: FlagSnapshot } })
  | ({ type: "snapshot.result" } & MsgBase & { ok: boolean, error?: { code: string, message: string, details?: any } })
  | ({ type: "fs.read.result" } & MsgBase & { ok: boolean, dataBase64?: string, error?: any })
  | ({ type: "fs.list.result" } & MsgBase & { ok: boolean, entries?: string[], error?: any })
  | ({ type: "merge.result" } & MsgBase & { ok: boolean, result?: any, trace?: any, error?: any })
  | ({ type: "export.result" } & MsgBase & { ok: boolean, uri?: string, error?: any })
  | ({ type: "status.autosave" } & MsgBase & { payload: { state: "idle"|"dirty"|"saving"|"saved" } })
  | ({ type: "gen.chunk" } & MsgBase & { payload: { text: string } })   // 将来
  | ({ type: "gen.done" } & MsgBase )
  | ({ type: "gen.error" } & MsgBase & { error: { code: string, message: string } })
  | ({ type: "error" } & MsgBase & { error: { code: string, message: string, details?: any } })
```
> **Base64**: バイナリは `Uint8Array` ⇄ base64 に相互変換。テキストJSONはUTF-8。

## 5. 代表シーケンス（時系列）

### 5.1 エディタ起動（resolveCustomTextEditor）
```
Extension: create WebviewPanel (CSP/nonce 設定)
Extension → Webview: "bootstrap" {doc, settings, flags}
Webview   → Extension: "ready" {uiVersion}
Webview   ：描画、state復元、保存インジケータ=○
```

### 5.2 編集→AutoSave→保存完了
```
Webview   ：編集開始 → dirty
Webview   ：デバウンス(~500ms)、アイドル(~2s)
Webview → Extension: "snapshot.request" {doc}
Extension ：atomicWrite(tmp→rename)、historyへ世代保存(N=20/50MB)
Extension → Webview: "snapshot.result" {ok:true}
Extension → Webview: "status.autosave" {state:"saved"}
```

### 5.3 精緻マージ（3-way）
```
Webview → Extension: "merge.request" {base,ours,theirs,threshold}
Extension: core.merge 実行 → trace出力
Extension → Webview: "merge.result" {ok:true,result,trace}
Webview   ：UIへ反映、採用/衝突分岐
```

### 5.4 Export（MD/CSV/JSONL）
```
Webview → Extension: "export.request" {format}
Extension: 正規化→ファイル生成→Uri返却
Extension → Webview: "export.result" {ok:true, uri}
```

## 6. エラーと再試行（方針）
- 失敗は**応答メッセージで通知**（throw禁止）。
- 再試行は**指数バックオフ**（100/300/900ms 目安）。
- `E_FS_ATOMIC` はユーザー提示（保存できない場合は復旧ダイアログへ）。

## 7. セキュリティ境界
- Webviewは**外部fetch禁止**。ネットは拡張側ゲートのみ。
- パスは**ワークスペース配下**に制限（サンドボックス）。
- CSP/nonce必須、`eval`禁止、`postMessage`は型検証して破棄。

## 8. バージョニング
- `MsgBase.apiVersion = 1`（将来はメジャーアップで互換を切る）。
- `storyboard.json.meta.apiVersion` と**別軸**。

## 9. 相互運用の注意
- 大きな`doc`は差分送信を検討（v1.0は全量でOK）。
- ストリーミング（`gen.chunk`）は1秒あたり10回までなど**バックプレッシャ**を導入。
