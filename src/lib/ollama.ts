import { OLLAMA_BASE } from '../config'

export type Chunk = { model?: string; message?: { role:string; content:string }; done?: boolean }
export type ChatStreamOptions = { timeoutMs?: number; maxChars?: number; controller?: AbortController; signal?: AbortSignal }

export async function* chatStream(model: string, prompt: string, opts: ChatStreamOptions = {}){
  const controller = opts.controller ?? (opts.signal ? null : new AbortController())
  const signal = opts.signal ?? controller?.signal
  if (!signal) throw new Error('chatStream requires an AbortSignal')
  const abort = () => { if (controller) controller.abort() }
  const timeout: ReturnType<typeof setTimeout> | null =
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
    const reader = res.body!.getReader()
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
      try{ yield JSON.parse(buf) as Chunk }catch{/* ignore trailing chunk */}
    }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
