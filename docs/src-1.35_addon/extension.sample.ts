// extension.sample.ts — VS Code 拡張サンプル（抜粋）
import * as vscode from 'vscode'
import { posix as path } from 'path'

import {
  AUTOSAVE_POLICY,
  type AutoSavePhaseGuardSnapshot,
  type AutoSaveSnapshotRequestMessage
} from '../../src/lib/autosave'
import {
  createVscodeAutoSaveBridge,
  type AutoSaveAtomicWriteInput,
  type AutoSaveAtomicWriteResult
} from '../../src/platform/vscode/autosave'

export function activate(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'conimgponic.storyboard',
      new ConimgEditorProvider(ctx),
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }
    )
  )
}

class ConimgEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly ctx: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const nonce = getNonce()
    panel.webview.options = { enableScripts: true, localResourceRoots: [this.ctx.extensionUri] }
    panel.webview.html = getHtml(panel.webview, this.ctx.extensionUri, nonce)

    const initialGuard: AutoSavePhaseGuardSnapshot = {
      featureFlag: { value: true, source: 'default' },
      optionsDisabled: false
    }

    const autosave = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard,
      now: () => new Date(),
      sendMessage: (message) => {
        panel.webview.postMessage({
          type: message.type,
          apiVersion: 1,
          reqId: message.reqId,
          payload: message.payload,
          ts: Date.now()
        })
      },
      atomicWrite: (input) => performAtomicWrite(document.uri, input),
      telemetry: (event) => console.log('[autosave]', event.name, event.properties ?? {}),
      warn: (event) => console.warn('[autosave:warn]', event.code, event.details ?? {})
    })

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
          case 'snapshot.request': {
            const envelope = toSnapshotRequestMessage(msg)
            if (msg.payload.reason === 'change') {
              autosave.reportDirty(msg.payload.pendingBytes, envelope.payload.guard)
            }
            await autosave.handleSnapshotRequest(envelope)
            return
          }
          case 'fs.read': {
            const data = await vscode.workspace.fs.readFile(vscode.Uri.parse(msg.payload.uri))
            panel.webview.postMessage({
              type: 'fs.read.result',
              apiVersion: 1,
              reqId: msg.reqId,
              payload: { ok: true, dataBase64: Buffer.from(data).toString('base64') }
            })
            return
          }
          case 'fs.atomicWrite': {
            const data = Buffer.from(msg.payload.dataBase64, 'base64')
            await vscode.workspace.fs.writeFile(vscode.Uri.parse(msg.payload.uri), data)
            panel.webview.postMessage({
              type: 'snapshot.result',
              apiVersion: 1,
              reqId: msg.reqId,
              payload: { ok: true, bytes: data.byteLength, generation: 0, lastSuccessAt: new Date().toISOString(), retainedBytes: data.byteLength }
            })
            return
          }
          case 'merge.request': {
            const { base, ours, theirs, threshold } = msg.payload
            const result = coreMerge(base, ours, theirs, threshold ?? 0.72)
            panel.webview.postMessage({ type: 'merge.result', apiVersion: 1, reqId: msg.reqId, payload: { ok: true, result } })
            return
          }
        }
      } catch (e: any) {
        panel.webview.postMessage({
          type: 'error',
          apiVersion: 1,
          reqId: msg.reqId,
          error: { code: 'E_RUNTIME', message: e?.message ?? String(e) }
        })
      }
    })
  }
}

async function performAtomicWrite(target: vscode.Uri, input: AutoSaveAtomicWriteInput): Promise<AutoSaveAtomicWriteResult> {
  const storyboardJson = JSON.stringify(input.request.payload.storyboard, null, 2)
  const bytes = Buffer.byteLength(storyboardJson, 'utf8')
  const data = Buffer.from(storyboardJson, 'utf8')

  const docDir = target.with({ path: path.dirname(target.path) })
  const autosaveDir = vscode.Uri.joinPath(docDir, 'autosave')
  const historyDir = vscode.Uri.joinPath(autosaveDir, 'history')
  const currentFile = vscode.Uri.joinPath(autosaveDir, 'current.json')
  const tmpFile = currentFile.with({ path: `${currentFile.path}.tmp` })

  await vscode.workspace.fs.createDirectory(historyDir)
  await vscode.workspace.fs.writeFile(tmpFile, data)
  await vscode.workspace.fs.rename(tmpFile, currentFile, { overwrite: true })

  const iso = sanitizeIso(new Date().toISOString())
  const historyFile = vscode.Uri.joinPath(historyDir, `${iso}.json`)
  await vscode.workspace.fs.writeFile(historyFile, data)

  const entries = await vscode.workspace.fs.readDirectory(historyDir)
  const jsonEntries = entries
    .filter(([name]) => name.endsWith('.json'))
    .sort((a, b) => a[0].localeCompare(b[0]))

  const survivors: Array<{ name: string; size: number }> = []
  let retainedBytes = bytes
  for (const [name] of jsonEntries) {
    const uri = vscode.Uri.joinPath(historyDir, name)
    if (name === `${iso}.json`) {
      survivors.push({ name, size: bytes })
      continue
    }
    const stat = await vscode.workspace.fs.stat(uri)
    survivors.push({ name, size: stat.size })
    retainedBytes += stat.size
  }

  while (survivors.length > AUTOSAVE_POLICY.maxGenerations || retainedBytes > AUTOSAVE_POLICY.maxBytes) {
    const removed = survivors.shift()
    if (!removed) break
    retainedBytes -= removed.size
    await vscode.workspace.fs.delete(vscode.Uri.joinPath(historyDir, removed.name))
  }

  return {
    ok: true,
    bytes,
    generation: input.request.payload.queuedGeneration,
    lastSuccessAt: new Date().toISOString(),
    lockStrategy: 'file-lock'
  }
}

function toSnapshotRequestMessage(msg: any): AutoSaveSnapshotRequestMessage {
  const guard = msg.payload.guard as AutoSavePhaseGuardSnapshot
  return {
    type: 'snapshot.request',
    phase: 'snapshot.request',
    reqId: msg.reqId ?? `req-${Date.now()}`,
    issuedAt: new Date().toISOString(),
    payload: {
      reason: msg.payload.reason ?? 'change',
      storyboard: msg.payload.storyboard,
      pendingBytes: msg.payload.pendingBytes,
      queuedGeneration: msg.payload.queuedGeneration,
      debounceMs: AUTOSAVE_POLICY.debounceMs,
      idleMs: AUTOSAVE_POLICY.idleMs,
      historyLimit: AUTOSAVE_POLICY.maxGenerations,
      sizeLimit: AUTOSAVE_POLICY.maxBytes,
      guard
    }
  }
}

function getHtml(webview: vscode.Webview, extUri: vscode.Uri, nonce: string) {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extUri, 'media', 'main.js'))
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extUri, 'media', 'main.css'))
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

function sanitizeIso(value: string): string {
  return value.replace(/[:]/g, '-').replace(/\./g, '_')
}

function getNonce() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}

function coreMerge(base: any, ours: any, theirs: any, threshold: number) {
  /* 実装はcoreへ */
  return { merged: ours, trace: [], threshold }
}
