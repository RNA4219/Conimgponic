/// <reference types="node" />
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Storyboard } from '../../src/types'
import type { ExportFormat, NormalizedOutputs, TelemetryCollector } from '../../src/lib/exporters'
import type { GoldenArtifacts, GoldenComparisonEntry, GoldenComparisonResult } from '../../src/lib/golden/compare'

type Mutable<T> = { -readonly [P in keyof T]: T[P] }

type ExporterModule = typeof import('../../src/lib/exporters')

let exporterModulePromise: Promise<ExporterModule> | null = null

const EXPORT_DIR = 'export'

async function loadExporterModule(): Promise<ExporterModule> {
  if (!exporterModulePromise) {
    exporterModulePromise = import(new URL('../../src/lib/exporters.ts', import.meta.url).href)
  }
  return exporterModulePromise
}

type NormalizationTools = Pick<ExporterModule, 'firstLineDiff' | 'normalizeJson' | 'normalizeJsonl' | 'trimLines'>
type ScalarFormat = Exclude<ExportFormat, 'package'>

const scalarFormats: readonly ScalarFormat[] = ['markdown', 'csv', 'jsonl']

function normalizeGoldenArtifact(
  format: ExportFormat,
  golden: GoldenArtifacts,
  tools: NormalizationTools,
  name?: string,
): string | undefined {
  switch (format) {
    case 'markdown':
      return golden.markdown ? tools.trimLines(golden.markdown) : undefined
    case 'csv':
      return golden.csv ? tools.trimLines(golden.csv) : undefined
    case 'jsonl':
      return golden.jsonl ? tools.normalizeJsonl(golden.jsonl) : undefined
    case 'package':
      if (!name) return undefined
      return golden.package[name] ? tools.normalizeJson(golden.package[name]) : undefined
    default:
      return undefined
  }
}

function compareToGolden(
  actual: NormalizedOutputs,
  golden: GoldenArtifacts,
  tools: NormalizationTools,
): GoldenComparisonResult {
  const entries: GoldenComparisonEntry[] = []

  scalarFormats.forEach((format) => {
    const expected = normalizeGoldenArtifact(format, golden, tools)
    if (!expected) {
      entries.push({ format, status: 'diff', diff: 'missing golden input' })
      return
    }
    if (expected === actual[format]) {
      entries.push({ format, status: 'matched' })
    } else {
      entries.push({ format, status: 'diff', diff: tools.firstLineDiff(actual[format], expected) })
    }
  })

  const packageNames = new Set([
    ...Object.keys(actual.package),
    ...Object.keys(golden.package ?? {}),
  ])

  packageNames.forEach((name) => {
    const actualPayload = actual.package[name]
    if (!actualPayload) {
      entries.push({ format: 'package', name, status: 'diff', diff: 'missing generated artifact' })
      return
    }
    const expected = normalizeGoldenArtifact('package', golden, tools, name)
    if (!expected) {
      entries.push({ format: 'package', name, status: 'diff', diff: 'missing golden input' })
      return
    }
    if (expected === actualPayload) {
      entries.push({ format: 'package', name, status: 'matched' })
    } else {
      entries.push({
        format: 'package',
        name,
        status: 'diff',
        diff: tools.firstLineDiff(actualPayload, expected),
      })
    }
  })

  const matched = entries.filter((entry) => entry.status === 'matched').length
  const matchRate = entries.length ? matched / entries.length : 0
  const ok = entries.length > 0 && matched === entries.length

  if (!ok) {
    return {
      entries,
      matchRate,
      ok,
      error: { message: 'Golden comparison failed', retryable: false },
    }
  }

  return { entries, matchRate, ok }
}

function summarizeComparison(entries: readonly GoldenComparisonEntry[]): string {
  if (!entries.length) {
    return 'No golden artifacts loaded'
  }
  return entries
    .map((entry) =>
      entry.status === 'matched'
        ? `${entry.format}${entry.name ? `:${entry.name}` : ''}: OK`
        : `${entry.format}${entry.name ? `:${entry.name}` : ''}: diff -> ${entry.diff ?? 'mismatch'}`,
    )
    .join('\n')
}

function createTelemetryFromComparison(
  comparison: GoldenComparisonResult,
  runId: string,
): { event: 'export.success' | 'export.failed'; payload: Record<string, unknown> } | null {
  if (!comparison.entries.length) {
    return null
  }
  const formats = Array.from(
    new Set(
      comparison.entries.map((entry) =>
        entry.format === 'package' && entry.name ? `package:${entry.name}` : entry.format,
      ),
    ),
  )
  const basePayload: Record<string, unknown> = {
    runId,
    matchRate: comparison.matchRate,
    formats,
  }
  if (comparison.ok) {
    return { event: 'export.success', payload: basePayload }
  }
  basePayload.retryable = comparison.error?.retryable ?? false
  basePayload.entries = comparison.entries.map((entry) => ({
    format: entry.format,
    name: entry.name ?? null,
    status: entry.status,
    diff: entry.diff ?? null,
  }))
  return { event: 'export.failed', payload: basePayload }
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

function toPosix(pathname: string): string {
  return pathname.split(sep).join('/')
}
async function writeActualFile(pathname: string, payload: string): Promise<void> {
  await mkdir(dirname(pathname), { recursive: true })
  await writeFile(pathname, `${payload}\n`, 'utf8')
}

function ensureDiffPath(outputDir: string): string {
  return join(outputDir, 'golden-diff.txt')
}

async function readExpected(pathname: string): Promise<string> {
  return readFile(pathname, 'utf8')
}

export async function compareStoryboardToGolden(options: CompareOptions): Promise<CompareResult> {
  const exporters = await loadExporterModule()
  const { createNormalizedOutputs, firstLineDiff, normalizeJson, normalizeJsonl, trimLines } = exporters

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

  await mkdir(baseDir, { recursive: true })

  await writeActualFile(join(baseDir, 'markdown', 'storyboard.md'), normalized.markdown)
  await writeActualFile(join(baseDir, 'csv', 'storyboard.csv'), normalized.csv)
  await writeActualFile(join(baseDir, 'jsonl', 'storyboard.jsonl'), normalized.jsonl)

  const packageDir = join(options.goldenDir, 'package')
  const actualPackageDir = join(baseDir, 'package')
  await mkdir(actualPackageDir, { recursive: true })
  const pkgEntries = Object.entries(normalized.package)
  for (const [name, payload] of pkgEntries) {
    await writeActualFile(join(actualPackageDir, name), payload)
  }

  const goldenArtifacts: Mutable<GoldenArtifacts> = { package: {} }

  const expectedPaths: Record<Exclude<ExportFormat, 'package'>, string> = {
    markdown: join(options.goldenDir, 'markdown', 'storyboard.md'),
    csv: join(options.goldenDir, 'csv', 'storyboard.csv'),
    jsonl: join(options.goldenDir, 'jsonl', 'storyboard.jsonl'),
  }

  for (const format of ['markdown', 'csv', 'jsonl'] as const) {
    const expectedPath = expectedPaths[format]
    if (existsSync(expectedPath)) {
      goldenArtifacts[format] = await readExpected(expectedPath)
    }
  }

  if (existsSync(packageDir)) {
    for (const name of await readdir(packageDir)) {
      const target = join(packageDir, name)
      if (existsSync(target)) {
        goldenArtifacts.package[name] = await readExpected(target)
      }
    }
  }

  const comparison = compareToGolden(normalized, goldenArtifacts, {
    firstLineDiff,
    normalizeJson,
    normalizeJsonl,
    trimLines,
  })

  const toCompareEntry = (entry: GoldenComparisonEntry): CompareEntry => {
    const expectedPath =
      entry.format === 'package' && entry.name
        ? join(packageDir, entry.name)
        : expectedPaths[entry.format as Exclude<ExportFormat, 'package'>]
    const actualPath =
      entry.format === 'package' && entry.name
        ? join(actualPackageDir, entry.name)
        : join(baseDir, entry.format, `storyboard.${entry.format === 'markdown' ? 'md' : entry.format}`)
    return {
      format: entry.format,
      expectedPath,
      actualPath,
      status: entry.status,
      diff: entry.diff,
    }
  }

  entries.push(...comparison.entries.map(toCompareEntry))

  const diffPath = ensureDiffPath(options.outputDir)
  const summary = summarizeComparison(comparison.entries)
  await writeFile(diffPath, `${summary}\n`, 'utf8')

  const normalizedPath = comparison.ok
    ? toPosix(relative(options.outputDir, baseDir))
    : ''
  const runUri = comparison.ok ? pathToFileURL(baseDir).href : ''

  const telemetryEvent = createTelemetryFromComparison(comparison, runId)
  if (telemetryEvent) {
    options.telemetry?.track(telemetryEvent.event, telemetryEvent.payload)
  }

  const result: CompareResult = {
    ok: comparison.ok,
    runUri,
    normalizedPath,
    diffPath,
    entries,
  }

  if (!comparison.ok && comparison.error) {
    result.error = comparison.error
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
