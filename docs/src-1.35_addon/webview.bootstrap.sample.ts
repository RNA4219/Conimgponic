// webview.bootstrap.sample.ts — Webview 側（抜粋）
type MsgBase = { type: string; apiVersion: 1; reqId?: string; ts?: number }
type ExtToWv = any; // 実際はAPI-CONTRACT参照

const vscode = acquireVsCodeApi()

function send(type:string, payload?:any, reqId?:string){
  const msg: MsgBase & any = { type, apiVersion: 1, ts: Date.now(), ...(payload?{payload}:{}), ...(reqId?{reqId}:{}) }
  window.parent.postMessage(msg, '*')
}

window.addEventListener('message', (ev: MessageEvent<ExtToWv>) => {
  const msg = ev.data
  switch(msg.type){
    case 'bootstrap':
      initUI(msg.payload.doc, msg.payload.settings)
      send('ready', { uiVersion: '1.0.0' })
      break
    case 'snapshot.result':
      // 保存インジケータを○へ
      break
    case 'merge.result':
      // UIへ結果反映
      break
    case 'status.autosave':
      // インジケータ表示更新
      break
  }
})

function requestSnapshot(doc:any){
  const reqId = crypto.randomUUID()
  send('snapshot.request', { doc }, reqId)
}
