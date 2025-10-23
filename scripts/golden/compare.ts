import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'

import type { Storyboard } from '../../src/types'

export type ExportFormat = 'markdown' | 'csv' | 'jsonl' | 'package'

export interface TelemetryCollector {
  track: (event: 'export.success' | 'export.failed', payload: Record<string, unknown>) => void
}

export interface CompareOptions {
  storyboardPath: string
  goldenDir: string
  outputDir: string
  runId?: string
  telemetry?: TelemetryCollector
}

export interface CompareEntry {
  format: ExportFormat
  expectedPath: string
  actualPath: string
  status: 'matched' | 'diff'
  diff?: string
}

export interface CompareResult {
  ok: boolean
  runUri: string
  normalizedPath: string
  diffPath: string
  entries: CompareEntry[]
  error?: {
    message: string
    retryable: boolean
  }
}

type PackageArtifacts = Record<string, string>

export interface NormalizedOutputs {
  markdown: string
  csv: string
  jsonl: string
  package: PackageArtifacts
}

const EXPORT_DIR = 'export'

function toPosix(pathname: string): string {
  return pathname.split(sep).join('/')
}

function trimLines(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd()
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

function normalizeJson(value: string, space = 2): string {
  const parsed = JSON.parse(value) as unknown
  return JSON.stringify(sortKeysDeep(parsed), null, space)
}

function normalizeJsonl(value: string): string {
  const lines = value.replace(/\r\n/g, '\n').split('\n').filter(Boolean)
  const normalized = lines.map((line) => normalizeJson(line, 0))
  return normalized.join('\n')
}

function firstLineDiff(a: string, b: string): string {
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

async function writeActualFile(pathname: string, payload: string): Promise<void> {
  await mkdir(dirname(pathname), { recursive: true })
  await writeFile(pathname, `${payload}\n`, 'utf8')
}

function ensureDiffPath(outputDir: string): string {
  return join(outputDir, 'golden-diff.txt')
}

function summarizeResult(entries: CompareEntry[]): string {
  return entries
    .map((entry) =>
      entry.status === 'matched'
        ? `${entry.format}: OK`
        : `${entry.format}: diff -> ${entry.diff ?? 'mismatch'}`,
    )
    .join('\n')
}

async function readExpected(pathname: string): Promise<string> {
  return readFile(pathname, 'utf8')
}

export async function compareStoryboardToGolden(options: CompareOptions): Promise<CompareResult> {
  const runId = options.runId ?? 'mock-run'
  const baseDir = join(options.outputDir, 'runs', runId, EXPORT_DIR)
  const entries: CompareEntry[] = []

  let storyboard: Storyboard
  try {
    const raw = await readFile(options.storyboardPath, 'utf8')
    storyboard = JSON.parse(raw) as Storyboard
  } catch (error) {
    const diffPath = ensureDiffPath(options.outputDir)
    await writeFile(diffPath, `failed to load storyboard: ${(error as Error).message}\n`, 'utf8')
    const result: CompareResult = {
      ok: false,
      entries,
      runUri: '',
      normalizedPath: '',
      diffPath,
      error: {
        message: 'Storyboard load failed',
        retryable: false,
      },
    }
    options.telemetry?.track('export.failed', { stage: 'load', retryable: false })
    return result
  }

  const normalized = createNormalizedOutputs(storyboard)

  const expectedPaths: Record<Exclude<ExportFormat, 'package'>, string> = {
    markdown: join(options.goldenDir, 'markdown', 'storyboard.md'),
    csv: join(options.goldenDir, 'csv', 'storyboard.csv'),
    jsonl: join(options.goldenDir, 'jsonl', 'storyboard.jsonl'),
  }

  await mkdir(baseDir, { recursive: true })

  await writeActualFile(join(baseDir, 'markdown', 'storyboard.md'), normalized.markdown)
  await writeActualFile(join(baseDir, 'csv', 'storyboard.csv'), normalized.csv)
  await writeActualFile(join(baseDir, 'jsonl', 'storyboard.jsonl'), normalized.jsonl)

  const diffLines: string[] = []

  for (const format of ['markdown', 'csv', 'jsonl'] as const) {
    const actualPath = join(baseDir, format, `storyboard.${format === 'markdown' ? 'md' : format}`)
    const expectedPath = expectedPaths[format]
    let expected: string
    try {
      expected = await readExpected(expectedPath)
    } catch (error) {
      const diff = `missing golden at ${expectedPath}`
      entries.push({
        format,
        expectedPath,
        actualPath,
        status: 'diff',
        diff,
      })
      diffLines.push(`${format}: ${diff}`)
      continue
    }
    const expectedNormalized =
      format === 'jsonl' ? normalizeJsonl(expected) : trimLines(expected)
    if (expectedNormalized === normalized[format]) {
      entries.push({
        format,
        expectedPath,
        actualPath,
        status: 'matched',
      })
      diffLines.push(`${format}: OK`)
    } else {
      const diff = firstLineDiff(normalized[format], expectedNormalized)
      entries.push({
        format,
        expectedPath,
        actualPath,
        status: 'diff',
        diff,
      })
      diffLines.push(`${format}: ${diff}`)
    }
  }

  const packageDir = join(options.goldenDir, 'package')
  const actualPackageDir = join(baseDir, 'package')
  await mkdir(actualPackageDir, { recursive: true })
  const pkgEntries = Object.entries(normalized.package)
  for (const [name, payload] of pkgEntries) {
    await writeActualFile(join(actualPackageDir, name), payload)
  }

  const expectedPackage: PackageArtifacts = {}
  if (existsSync(packageDir)) {
    for (const [name] of pkgEntries) {
      const target = join(packageDir, name)
      if (existsSync(target)) {
        expectedPackage[name] = normalizeJson(await readExpected(target))
      }
    }
  }

  for (const [name, payload] of pkgEntries) {
    const actualPath = join(actualPackageDir, name)
    const expectedPath = join(packageDir, name)
    const expectedPayload = expectedPackage[name]
    if (expectedPayload && expectedPayload === payload) {
      entries.push({
        format: 'package',
        expectedPath,
        actualPath,
        status: 'matched',
      })
      diffLines.push(`package:${name}: OK`)
    } else if (!expectedPayload) {
      const diff = `missing golden at ${expectedPath}`
      entries.push({
        format: 'package',
        expectedPath,
        actualPath,
        status: 'diff',
        diff,
      })
      diffLines.push(`package:${name}: ${diff}`)
    } else {
      const diff = firstLineDiff(payload, expectedPayload)
      entries.push({
        format: 'package',
        expectedPath,
        actualPath,
        status: 'diff',
        diff,
      })
      diffLines.push(`package:${name}: ${diff}`)
    }
  }

  const diffPath = ensureDiffPath(options.outputDir)
  const summary = summarizeResult(entries)
  await writeFile(diffPath, `${summary}\n`, 'utf8')

  const ok = entries.every((entry) => entry.status === 'matched')
  const normalizedPath = ok ? toPosix(relative(process.cwd(), baseDir)) : ''
  const runUri = ok ? `file://${normalizedPath}` : ''

  if (ok) {
    options.telemetry?.track('export.success', { runId, formats: ['markdown', 'csv', 'jsonl', 'package'] })
  } else {
    options.telemetry?.track('export.failed', { runId, retryable: false })
  }

  const result: CompareResult = {
    ok,
    runUri,
    normalizedPath,
    diffPath,
    entries,
  }

  if (!ok) {
    result.error = {
      message: 'Golden comparison failed',
      retryable: false,
    }
  }

  return result
}

export default async function main(): Promise<void> {
  const invokedDirectly = Boolean(process.argv[1] && basename(process.argv[1]) === 'compare.ts')
  if (!invokedDirectly) {
    return
  }

  const [storyboardPath, goldenDir, outputDir] = process.argv.slice(2)
  if (!storyboardPath || !goldenDir || !outputDir) {
    throw new Error('Usage: compare.ts <storyboardPath> <goldenDir> <outputDir>')
  }

  const result = await compareStoryboardToGolden({ storyboardPath, goldenDir, outputDir })
  if (!result.ok) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
