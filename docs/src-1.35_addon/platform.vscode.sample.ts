// platform.vscode.sample.ts — platform.ts 実装例（VS Code版）
export interface Platform {
  fs: {
    read(uri: string): Promise<Uint8Array>
    write(uri: string, data: Uint8Array): Promise<void>
    list(dir: string): Promise<string[]>
    atomicWrite(uri: string, data: Uint8Array): Promise<void>
  }
  settings: {
    get<T>(key: string, def: T): T
    set<T>(key: string, val: T): Promise<void>
  }
  dialog: {
    open(opts: any): Promise<string[]>
    save(opts: any): Promise<string|null>
  }
  net: {
    fetch(input: RequestInfo, init?: RequestInit): Promise<Response>
  }
}

declare const vscode: any

export const platform: Platform = {
  fs: {
    async read(uri){ return base64ToBytes(await rpc('fs.read', { uri })) },
    async write(uri, data){ await rpc('fs.write', { uri, dataBase64: bytesToBase64(data) }) },
    async list(dir){ return await rpc('fs.list', { dir }) },
    async atomicWrite(uri, data){ await rpc('fs.atomicWrite', { uri, dataBase64: bytesToBase64(data) }) },
  },
  settings: {
    get(key, def){ /* bootstrap.settings を保持して返す */ return def },
    async set(key, val){ /* 将来: 拡張側へ保存 */ },
  },
  dialog: {
    async open(opts){ /* 将来: 拡張側ゲート */ return [] },
    async save(opts){ return null },
  },
  net: {
    async fetch(input, init){ throw new Error('net.fetch disabled in v1.0') }
  }
}

async function rpc(type:string, payload:any){
  const reqId = crypto.randomUUID()
  const p = new Promise<any>((resolve, reject)=>{
    function onMsg(ev: MessageEvent<any>){
      const m = ev.data
      if(m && m.reqId === reqId && m.type.endsWith('.result')){
        window.removeEventListener('message', onMsg)
        if(m.ok) resolve(m.dataBase64 ?? m.entries ?? m)
        else reject(m.error)
      }
    }
    window.addEventListener('message', onMsg)
  })
  window.parent.postMessage({ type, apiVersion: 1, reqId, payload }, '*')
  return p
}

function bytesToBase64(u8:Uint8Array){ return btoa(String.fromCharCode(...u8)) }
function base64ToBytes(b64:string){ return new Uint8Array(atob(b64).split('').map(c=>c.charCodeAt(0))) }
