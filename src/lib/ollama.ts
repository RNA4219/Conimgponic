import { OLLAMA_BASE } from '../config'

export type Chunk = { model?: string; message?: { role:string; content:string }; done?: boolean }

export async function* chatStream(model: string, prompt: string, opts: {timeoutMs?: number, maxChars?: number} = {}){
  const ac = new AbortController();
  const t = opts.timeoutMs ? setTimeout(()=> ac.abort(), opts.timeoutMs) : null as any;
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        model, stream: true,
        messages: [{role:'user', content: prompt}]
      }),
      signal: ac.signal
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
            if (total > max){ ac.abort(); break }
          }
          yield c
        }catch{ /* ignore broken chunk */ }
      }
    }
    if (buf.trim()){
      try{ yield JSON.parse(buf) as Chunk }catch{}
    }
  } finally { if (opts.timeoutMs && (t as any)) clearTimeout(t) }
}
