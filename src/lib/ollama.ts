import { OLLAMA_BASE } from '../config'

export type Chunk = { model?: string; message?: { role:string; content:string }; done?: boolean }
export type ChatStreamOptions = { timeoutMs?: number; maxChars?: number; controller?: AbortController; signal?: AbortSignal }

export class OllamaRequestError extends Error {
  readonly status: number
  readonly statusText: string
  readonly detail: string

  constructor(status: number, statusText: string, detail: string){
    const base = `HTTP ${status} ${statusText || 'Unknown'}`
    super(detail ? `${base}: ${detail}` : base)
    this.name = 'OllamaRequestError'
    this.status = status
    this.statusText = statusText
    this.detail = detail
  }
}

async function readErrorDetail(res: Response): Promise<string>{
  const limit = 200
  let detail = ''
  let truncated = false
  try {
    if (res.body){
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      try {
        while (detail.length < limit){
          const { done, value } = await reader.read()
          if (done) break
          detail += decoder.decode(value, { stream: true })
          if (detail.length > limit){
            detail = detail.slice(0, limit)
            truncated = true
            break
          }
        }
      } finally {
        try { await reader.cancel() } catch { /* ignore */ }
      }
    } else if (typeof res.text === 'function'){
      detail = await res.text()
      if (detail.length > limit){
        detail = detail.slice(0, limit)
        truncated = true
      }
    }
  } catch {
    return ''
  }
  detail = detail.trim()
  if (!detail) return ''
  return truncated ? `${detail.trimEnd()}…` : detail
}

export async function* chatStream(model: string, prompt: string, opts: ChatStreamOptions = {}){
  const controller = opts.controller ?? (opts.signal ? null : new AbortController())
  const signal = opts.signal ?? controller?.signal
  if (!signal) throw new Error('chatStream requires an AbortSignal')
  const abort = () => { if (controller) controller.abort() }
  const timeoutHandle: ReturnType<typeof setTimeout> | null =
    opts.timeoutMs && controller ? setTimeout(() => abort(), opts.timeoutMs) : null
  let stop = false
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        model, stream: true,
        messages: [{role:'user', content: prompt}]
      }),
      signal
    })
    if (!res.ok){
      const detail = await readErrorDetail(res)
      throw new OllamaRequestError(res.status, res.statusText, detail)
    }
    if (!res.body) throw new Error('chatStream requires a response body')
    const reader = res.body.getReader()
    const td = new TextDecoder()
    let buf = ''
    let total = 0
    const max = opts.maxChars ?? 20000
    while(true){
      const { done, value } = await reader.read()
      if (done) break
      buf += td.decode(value, {stream:true})
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines){
        if (!line.trim()) continue
        try{
          const c = JSON.parse(line) as Chunk
          if (c.message?.content){
            total += c.message.content.length
            if (total > max){ abort(); stop = true; break }
          }
          yield c
        }catch{ /* ignore broken chunk */ }
      }
      if (stop) break
    }
    if (buf.trim()){
      try{ yield JSON.parse(buf) as Chunk }catch (error){
        console.warn('Failed to parse trailing Ollama chunk', error)
      }
    }
  } finally {
    if (opts.timeoutMs && timeoutHandle){
      clearTimeout(timeoutHandle)
    }
  }
}
