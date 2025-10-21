import type { Storyboard } from '../types'

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
  const idx = new Map(sb.scenes.map((s,i)=> [s.id, i]))
  for (const ln of lines){
    try{
      const o = JSON.parse(ln)
      const i = idx.get(o.id)
      if (i != null){
        const sc = sb.scenes[i]
        const patch: any = { seed: o.seed ?? sc.seed, tone: o.tone ?? sc.tone, slate: o.slate ?? sc.slate, shot: o.shot ?? sc.shot, take: (Number.isFinite(o.take)? o.take: sc.take) }
        patch[mode] = String(o.text||'')
        sb.scenes[i] = { ...sc, ...patch }
      }else{
        sb.scenes.push({ id: o.id, manual: mode==='manual'? String(o.text||''):'', ai: mode==='ai'? String(o.text||''):'', status:'idle', seed:o.seed, tone:o.tone, assets: [], slate:o.slate, shot:o.shot, take:o.take })
      }
    }catch{ /* ignore bad line */ }
  }
  return sb
}

export function mergeCSV(sb: Storyboard, csv: string, mode: ImportMode = 'manual'){
  const lines = csv.split(/\r?\n/).filter(Boolean)
  if (!lines.length) return sb
  const head = lines[0].split(',').map(s=> s.trim().replace(/^"|"$/g,''))
  const idIdx = head.indexOf('id')
  const textIdx = head.indexOf('text')
  const seedIdx = head.indexOf('seed')
  const toneIdx = head.indexOf('tone')
  const slateIdx = head.indexOf('slate')
  const shotIdx = head.indexOf('shot')
  const takeIdx = head.indexOf('take')
  const idx = new Map(sb.scenes.map((s,i)=> [s.id, i]))
  for (let i=1;i<lines.length;i++){
    const cols = parseCSVLine(lines[i])
    const id = cols[idIdx]?.replace(/^"|"$/g,'')
    const text = cols[textIdx]?.replace(/^"|"$/g,'').replace(/\\n/g,'\n') || ''
    const seed = cols[seedIdx] ? Number(cols[seedIdx]) : undefined
    const tone = cols[toneIdx]?.replace(/^"|"$/g,'') || undefined
    const slate = slateIdx>=0? (cols[slateIdx]?.replace(/^"|"$/g,'') || undefined): undefined
    const shot = shotIdx>=0? (cols[shotIdx]?.replace(/^"|"$/g,'') || undefined): undefined
    const take = takeIdx>=0? (cols[takeIdx]? Number(cols[takeIdx]): undefined): undefined
    if (!id) continue
    const j = idx.get(id)
    if (j != null){
      const sc = sb.scenes[j]
      const patch: any = { seed: (Number.isFinite(seed)? seed: sc.seed), tone: tone ?? sc.tone, slate: slate ?? sc.slate, shot: shot ?? sc.shot, take: (Number.isFinite(take)? take: sc.take) }
      patch[mode] = text
      sb.scenes[j] = { ...sc, ...patch }
    }else{
      sb.scenes.push({ id, manual: mode==='manual'? text:'', ai: mode==='ai'? text:'', status:'idle', seed: (Number.isFinite(seed)? seed: undefined), tone, assets: [], slate, shot, take })
    }
  }
  return sb
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
