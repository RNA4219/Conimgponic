import type { Scene, Storyboard } from '../types'

export async function readFileAsText(file: File): Promise<string>{
  return new Promise((res, rej)=>{
    const r = new FileReader()
    r.onerror = () => rej(r.error)
    r.onload = () => res(String(r.result||''))
    r.readAsText(file, 'utf-8')
  })
}

export type ImportMode = 'manual'|'ai'

export function mergeJSONL(sb: Storyboard, text: string, mode: ImportMode = 'manual'){
  const lines = text.split(/\r?\n/).filter(Boolean)
  const next: Storyboard = { ...sb, scenes: sb.scenes.map(s => ({ ...s })) }
  const idx = new Map(next.scenes.map((s,i)=> [s.id, i]))
  for (const ln of lines){
    try{
      const o = JSON.parse(ln)
      const id = extractSceneId(o.id)
      if (!id) {
        continue
      }

      const i = idx.get(id)
      const seed = normalizeNumber(o.seed)
      const take = normalizeNumber(o.take)
      const rating = normalizeSceneRating(o.rating)
      const text = normalizeSceneText(o.text)

      if (i != null){
        const sc = next.scenes[i]
        const patch: Partial<Scene> & Record<ImportMode, string> = {
          seed: seed ?? sc.seed,
          tone: o.tone ?? sc.tone,
          slate: o.slate ?? sc.slate,
          shot: o.shot ?? sc.shot,
          take: take ?? sc.take,
          rating: rating ?? sc.rating,
          manual: sc.manual,
          ai: sc.ai
        }
        if (text !== undefined) {
          patch[mode] = text
        }
        next.scenes[i] = { ...sc, ...patch }
      }else{
        const sceneText = text ?? ''
        next.scenes.push({ id, manual: mode==='manual'? sceneText:'', ai: mode==='ai'? sceneText:'', status:'idle', seed: seed, tone:o.tone, assets: [], slate:o.slate, shot:o.shot, take: take, rating })
        if (!idx.has(id)) {
          idx.set(id, next.scenes.length - 1)
        }
      }
    }catch{ /* ignore bad line */ }
  }
  return next
}

function extractSceneId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined
  }

  const trimmed = raw.trim()
  if (!trimmed) {
    return undefined
  }

  return trimmed
}

export function mergeCSV(sb: Storyboard, csv: string, mode: ImportMode = 'manual'){
  const lines = csv.split(/\r?\n/).filter(Boolean)
  const next: Storyboard = { ...sb, scenes: sb.scenes.map(s => ({ ...s })) }
  if (!lines.length) return next
  const head = lines[0].split(',').map(s=> s.trim().replace(/(^"|"$)/g,''))
  const idIdx = head.indexOf('id')
  const textIdx = head.indexOf('text')
  const seedIdx = head.indexOf('seed')
  const toneIdx = head.indexOf('tone')
  const slateIdx = head.indexOf('slate')
  const shotIdx = head.indexOf('shot')
  const takeIdx = head.indexOf('take')
  const idx = new Map(next.scenes.map((s,i)=> [s.id, i]))
  for (let i=1;i<lines.length;i++){
    const cols = parseCSVLine(lines[i])
    const id = cols[idIdx]?.replace(/(?:^"|"$)/g, '')
    const text = cols[textIdx]?.replace(/(?:^"|"$)/g, '').replace(/\\n/g, '\n') || ''
    const seed = seedIdx >= 0 ? normalizeNumber(cols[seedIdx]) : undefined
    const tone = cols[toneIdx]?.replace(/(?:^"|"$)/g, '') || undefined
    const slate = slateIdx >= 0 ? (cols[slateIdx]?.replace(/(?:^"|"$)/g, '') || undefined) : undefined
    const shot = shotIdx >= 0 ? (cols[shotIdx]?.replace(/(?:^"|"$)/g, '') || undefined) : undefined
    const take = takeIdx >= 0 ? normalizeNumber(cols[takeIdx]) : undefined

    if (!id) continue
    const j = idx.get(id)
    if (j != null){
      const sc = next.scenes[j]
      const patch: Partial<Scene> & Record<ImportMode, string> = {
        seed: seed ?? sc.seed,
        tone: tone ?? sc.tone,
        slate: slate ?? sc.slate,
        shot: shot ?? sc.shot,
        take: take ?? sc.take,
        manual: sc.manual,
        ai: sc.ai
      }
      patch[mode] = text
      next.scenes[j] = { ...sc, ...patch }
    }else{
      const scene: Scene = {
        id,
        manual: mode === 'manual' ? text : '',
        ai: mode === 'ai' ? text : '',
        status: 'idle',
        tone,
        assets: [],
        slate,
        shot,
      }

      if (seed !== undefined) {
        scene.seed = seed
      }

      if (take !== undefined) {
        scene.take = take
      }

      next.scenes.push(scene)
      idx.set(id, next.scenes.length - 1)
    }
  }
  return next
}

function parseCSVLine(line: string){
  const out:string[] = []
  let cur=''; let inQ=false
  for (let i=0;i<line.length;i++){
    const ch = line[i]
    if (inQ){
      if (ch === '"'){
        if (line[i+1] === '"'){ cur+='"'; i++ } else { inQ=false }
      }else cur += ch
    }else{
      if (ch === ','){ out.push(cur); cur='' }
      else if (ch === '"'){ inQ=true }
      else cur += ch
    }
  }
  out.push(cur)
  return out
}

function normalizeSceneText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }

  return undefined
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return undefined
}

function normalizeSceneRating(value: unknown): Scene['rating'] | undefined {
  const normalized = normalizeNumber(value)
  if (normalized === undefined) return undefined
  if (!Number.isInteger(normalized)) return undefined
  if (normalized < 1 || normalized > 5) return undefined
  return normalized as Scene['rating']
}
