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

// LLM Provider configuration
type LLMProvider = 'openai' | 'alibaba' | 'local' | 'none'

interface LLMConfig {
  provider: LLMProvider
  apiKey: string
  model: string
  baseUrl: string
}

function getLLMConfig(): LLMConfig {
  const env = import.meta.env
  const provider = (env.VITE_LLM_PROVIDER as LLMProvider) || 'local'

  if (provider === 'alibaba') {
    return {
      provider: 'alibaba',
      apiKey: env.VITE_DASHSCOPE_API_KEY || '',
      model: env.VITE_ALIBABA_MODEL || 'glm-5',
      baseUrl: env.VITE_ALIBABA_BASE_URL || 'https://coding-intl.dashscope.aliyuncs.com/v1'
    }
  }

  if (provider === 'openai') {
    return {
      provider: 'openai',
      apiKey: env.VITE_OPENAI_API_KEY || '',
      model: env.VITE_OPENAI_MODEL || 'gpt-4o-mini',
      baseUrl: env.VITE_OPENAI_BASE_URL || 'https://api.openai.com/v1'
    }
  }

  // Local (Ollama)
  return {
    provider: 'local',
    apiKey: '',
    model: 'llama3',
    baseUrl: OLLAMA_BASE
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

// OpenAI-compatible API stream (for Alibaba, OpenAI, OpenRouter)
async function* openAICompatibleStream(
  config: LLMConfig,
  prompt: string,
  opts: ChatStreamOptions
): AsyncGenerator<Chunk> {
  const controller = opts.controller ?? (opts.signal ? null : new AbortController())
  const signal = opts.signal ?? controller?.signal
  if (!signal) throw new Error('chatStream requires an AbortSignal')
  const abort = () => { if (controller) controller.abort() }
  const timeoutHandle: ReturnType<typeof setTimeout> | null =
    opts.timeoutMs && controller ? setTimeout(() => abort(), opts.timeoutMs) : null
  let stop = false

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        stream: true,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal
    })

    if (!res.ok) {
      const detail = await readErrorDetail(res)
      throw new OllamaRequestError(res.status, res.statusText, detail)
    }

    if (!res.body) throw new Error('chatStream requires a response body')
    const reader = res.body.getReader()
    const td = new TextDecoder()
    let buf = ''
    let total = 0
    const max = opts.maxChars ?? 20000

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += td.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)
          const content = parsed.choices?.[0]?.delta?.content
          if (content) {
            total += content.length
            if (total > max) { abort(); stop = true; break }
            yield { message: { role: 'assistant', content } }
          }
        } catch { /* ignore broken chunk */ }
      }
      if (stop) break
    }
  } finally {
    if (opts.timeoutMs && timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}

// Ollama local API stream
async function* ollamaStream(
  model: string,
  prompt: string,
  opts: ChatStreamOptions
): AsyncGenerator<Chunk> {
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

export async function* chatStream(model: string, prompt: string, opts: ChatStreamOptions = {}): AsyncGenerator<Chunk> {
  const config = getLLMConfig()

  // Use OpenAI-compatible API for cloud providers
  if (config.provider === 'alibaba' || config.provider === 'openai') {
    yield* openAICompatibleStream(config, prompt, opts)
    return
  }

  // Use Ollama for local
  yield* ollamaStream(model || config.model, prompt, opts)
}