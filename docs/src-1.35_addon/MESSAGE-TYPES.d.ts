// MESSAGE-TYPES.d.ts — メッセージ型（Webview/Extension共有用・抜粋）
export type MsgBase = { type: string; apiVersion: 1; reqId?: string; ts?: number }

export type WvToExt =
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
  | ({ type: "gen.request" } & MsgBase & { payload: { prompt: string, opts?: Record<string, any> } })

export type ExtToWv =
  | ({ type: "bootstrap" } & MsgBase & { payload: { doc: any, settings: Record<string, any> } })
  | ({ type: "snapshot.result" } & MsgBase & { ok: boolean, error?: { code: string, message: string, details?: any } })
  | ({ type: "fs.read.result" } & MsgBase & { ok: boolean, dataBase64?: string, error?: any })
  | ({ type: "fs.list.result" } & MsgBase & { ok: boolean, entries?: string[], error?: any })
  | ({ type: "merge.result" } & MsgBase & { ok: boolean, result?: any, trace?: any, error?: any })
  | ({ type: "export.result" } & MsgBase & { ok: boolean, uri?: string, error?: any })
  | ({ type: "status.autosave" } & MsgBase & { payload: { state: "idle"|"dirty"|"saving"|"saved" } })
  | ({ type: "gen.chunk" } & MsgBase & { payload: { text: string } })
  | ({ type: "gen.done" } & MsgBase )
  | ({ type: "gen.error" } & MsgBase & { error: { code: string, message: string } })
  | ({ type: "error" } & MsgBase & { error: { code: string, message: string, details?: any } })
