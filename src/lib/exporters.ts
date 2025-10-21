import type { Storyboard } from '../types'

export function toMarkdown(sb: Storyboard): string{
  const lines = [`# ${sb.title}`]
  sb.scenes.forEach((s, i)=>{
    lines.push(`\n## Cut ${i+1}`)
    lines.push(`<!-- id:${s.id} seed:${s.seed ?? ''} tone:${s.tone ?? ''} slate:${s.slate ?? ''} shot:${s.shot ?? ''} take:${s.take ?? ''} -->`)
    const body = (s.manual || s.ai || '').trim()
    lines.push(body || '(empty)')
  })
  return lines.join('\n')
}

export function toCSV(sb: Storyboard): string{
  const head = ['id','index','text','seed','tone','slate','shot','take']
  const rows = [head.join(',')]
  sb.scenes.forEach((s, i)=>{
    const text = (s.manual || s.ai || '').replace(/\n/g,'\\n').replace(/"/g,'""')
    rows.push([`"${s.id}"`, i+1, `"${text}"`, s.seed ?? '', `"${s.tone ?? ''}"`, `"${s.slate ?? ''}"`, `"${s.shot ?? ''}"`, s.take ?? ''].join(','))
  })
  return rows.join('\n')
}

export function toJSONL(sb: Storyboard): string{
  const lines: string[] = []
  sb.scenes.forEach((s, i)=>{
    const o = { id: s.id, index: i+1, text: (s.manual || s.ai || ''), seed: s.seed, tone: s.tone, slate: s.slate, shot: s.shot, take: s.take }
    lines.push(JSON.stringify(o))
  })
  return lines.join('\n')
}

export function downloadText(filename: string, content: string){
  const blob = new Blob([content], {type: 'text/plain;charset=utf-8'})
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(()=> URL.revokeObjectURL(url), 2000)
}
