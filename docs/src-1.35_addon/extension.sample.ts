// extension.sample.ts — VS Code 拡張サンプル（抜粋）
import * as vscode from 'vscode'

export function activate(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(vscode.window.registerCustomEditorProvider(
    'conimgponic.storyboard',
    new ConimgEditorProvider(ctx),
    { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }
  ))
}

class ConimgEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly ctx: vscode.ExtensionContext) {}
  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const nonce = getNonce()
    panel.webview.options = { enableScripts: true, localResourceRoots: [this.ctx.extensionUri] }
    panel.webview.html = getHtml(panel.webview, this.ctx.extensionUri, nonce)

    const bootstrap = {
      type: 'bootstrap',
      apiVersion: 1,
      payload: { doc: JSON.parse(document.getText() || '{}'), settings: vscode.workspace.getConfiguration('conimg') }
    }
    panel.webview.postMessage(bootstrap)

    panel.webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.type) {
          case 'ready':
            return
          case 'snapshot.request':
            await atomicWrite(document.uri, Buffer.from(JSON.stringify(msg.payload.doc, null, 2), 'utf8'))
            panel.webview.postMessage({ type: 'snapshot.result', apiVersion: 1, reqId: msg.reqId, ok: true })
            return
          case 'fs.read': {
            const data = await vscode.workspace.fs.readFile(vscode.Uri.parse(msg.payload.uri))
            panel.webview.postMessage({ type: 'fs.read.result', apiVersion: 1, reqId: msg.reqId, ok: true, dataBase64: Buffer.from(data).toString('base64') })
            return
          }
          case 'fs.atomicWrite': {
            const data = Buffer.from(msg.payload.dataBase64, 'base64')
            await atomicWrite(vscode.Uri.parse(msg.payload.uri), data)
            panel.webview.postMessage({ type: 'snapshot.result', apiVersion: 1, reqId: msg.reqId, ok: true })
            return
          }
          case 'merge.request': {
            const { base, ours, theirs, threshold } = msg.payload
            const result = coreMerge(base, ours, theirs, threshold ?? 0.72)
            panel.webview.postMessage({ type: 'merge.result', apiVersion: 1, reqId: msg.reqId, ok: true, result })
            return
          }
        }
      } catch (e:any) {
        panel.webview.postMessage({ type: 'error', apiVersion: 1, reqId: msg.reqId, error: { code: 'E_RUNTIME', message: e?.message ?? String(e) } })
      }
    })
  }
}

async function atomicWrite(target: vscode.Uri, data: Buffer) {
  const tmp = target.with({ path: target.path + '.tmp' })
  await vscode.workspace.fs.writeFile(tmp, data)
  await vscode.workspace.fs.rename(tmp, target, { overwrite: true })
}

function getHtml(webview: vscode.Webview, extUri: vscode.Uri, nonce: string) {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extUri, 'media', 'main.js'))
  const styleUri  = webview.asWebviewUri(vscode.Uri.joinPath(extUri, 'media', 'main.css'))
  const csp = `default-src 'none'; img-src ${webview.cspSource} blob:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`
  return /* html */ `<!doctype html>
<html><head>
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${styleUri}" nonce="${nonce}">
</head><body>
<div id="root"></div>
<script nonce="${nonce}">const vscode = acquireVsCodeApi();</script>
<script src="${scriptUri}" nonce="${nonce}"></script>
</body></html>`
}

function getNonce() { return (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)) }
function coreMerge(base:any, ours:any, theirs:any, threshold:number){ /* 実装はcoreへ */ return { merged: ours, trace: [] } }
