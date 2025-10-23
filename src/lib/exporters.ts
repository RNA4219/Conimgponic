import type { Storyboard } from '../types'

export type ExportFormat = 'markdown' | 'csv' | 'jsonl' | 'package'

export interface TelemetryCollector {
  track: (event: 'export.success' | 'export.failed', payload: Record<string, unknown>) => void
}

export type PackageArtifacts = Record<string, string>

export interface NormalizedOutputs {
  readonly markdown: string
  readonly csv: string
  readonly jsonl: string
  readonly package: PackageArtifacts
}

export function trimLines(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd()
}

function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item)) as unknown as T
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, sortKeysDeep(v)])
    return Object.fromEntries(entries) as unknown as T
  }
  return value
}

export function normalizeJson(value: string, space = 2): string {
  const parsed = JSON.parse(value) as unknown
  return JSON.stringify(sortKeysDeep(parsed), null, space)
}

export function normalizeJsonl(value: string): string {
  const lines = value.replace(/\r\n/g, '\n').split('\n').filter(Boolean)
  const normalized = lines.map((line) => normalizeJson(line, 0))
  return normalized.join('\n')
}

export function firstLineDiff(a: string, b: string): string {
  const aLines = a.split('\n')
  const bLines = b.split('\n')
  const length = Math.max(aLines.length, bLines.length)
  for (let i = 0; i < length; i += 1) {
    if (aLines[i] !== bLines[i]) {
      return `line ${i + 1}: expected=${JSON.stringify(bLines[i] ?? '')} actual=${JSON.stringify(aLines[i] ?? '')}`
    }
  }
  return 'files differ in length'
}

function renderMarkdown(storyboard: Storyboard): string {
  const blocks: string[] = [`# ${storyboard.title}`]
  storyboard.scenes.forEach((scene, index) => {
    blocks.push('')
    blocks.push(`## Cut ${index + 1}`)
    const body = (scene.manual || scene.ai || '').trim()
    blocks.push(body || '(empty)')
  })
  return blocks.join('\n')
}

function escapeCsv(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n')
  return `"${normalized.replace(/"/g, '""')}"`
}

function renderCsv(storyboard: Storyboard): string {
  const rows: string[] = ['id,index,text,seed,tone,slate,shot,take']
  storyboard.scenes.forEach((scene, index) => {
    rows.push(
      [
        escapeCsv(scene.id),
        String(index + 1),
        escapeCsv(scene.manual || scene.ai || ''),
        scene.seed ?? '',
        escapeCsv(scene.tone ?? ''),
        escapeCsv(scene.slate ?? ''),
        escapeCsv(scene.shot ?? ''),
        scene.take ?? '',
      ].join(','),
    )
  })
  return rows.join('\n')
}

function renderJsonl(storyboard: Storyboard): string {
  const lines: string[] = []
  storyboard.scenes.forEach((scene, index) => {
    const payload: Record<string, unknown> = {
      id: scene.id,
      index: index + 1,
      text: scene.manual || scene.ai || '',
    }
    if (scene.seed !== undefined) payload.seed = scene.seed
    if (scene.tone) payload.tone = scene.tone
    if (scene.slate) payload.slate = scene.slate
    if (scene.shot) payload.shot = scene.shot
    if (scene.take !== undefined) payload.take = scene.take
    lines.push(JSON.stringify(payload))
  })
  return lines.join('\n')
}

function buildPackageArtifacts(storyboard: Storyboard): PackageArtifacts {
  const base: PackageArtifacts = {}
  base['storyboard.json'] = JSON.stringify(sortKeysDeep(storyboard), null, 2)
  base['export-info.json'] = JSON.stringify(
    sortKeysDeep({
      storyboardId: storyboard.id,
      title: storyboard.title,
      version: storyboard.version,
      formats: ['markdown', 'csv', 'jsonl'],
    }),
    null,
    2,
  )
  return base
}

export function createNormalizedOutputs(storyboard: Storyboard): NormalizedOutputs {
  const markdown = trimLines(renderMarkdown(storyboard))
  const csv = trimLines(renderCsv(storyboard))
  const jsonl = normalizeJsonl(renderJsonl(storyboard))
  const pkg = buildPackageArtifacts(storyboard)
  return {
    markdown,
    csv,
    jsonl,
    package: Object.fromEntries(
      Object.entries(pkg).map(([k, v]) => [k, normalizeJson(v)]) as [string, string][],
    ),
  }
}

export function toMarkdown(sb: Storyboard): string{
  return createNormalizedOutputs(sb).markdown
}

export function toCSV(sb: Storyboard): string{
  return createNormalizedOutputs(sb).csv
}

export function toJSONL(sb: Storyboard): string{
  return createNormalizedOutputs(sb).jsonl
}

export function downloadText(filename: string, content: string){
  const blob = new Blob([content], {type: 'text/plain;charset=utf-8'})
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(()=> URL.revokeObjectURL(url), 2000)
}
