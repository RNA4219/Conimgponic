/// <reference types="node" />
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'

import type { Storyboard } from '../../src/types'
import type { ExportFormat, TelemetryCollector } from '../../src/lib/exporters'
import {
  compareNormalizedOutputs,
  createTelemetryEvent,
  formatComparisonSummary,
  type GoldenArtifacts,
  type GoldenComparisonEntry,
} from '../../src/lib/golden/compare'

type ExporterModule = typeof import('../../src/lib/exporters')

let exporterModulePromise: Promise<ExporterModule> | null = null

const EXPORT_DIR = 'export'

async function loadExporterModule(): Promise<ExporterModule> {
  if (!exporterModulePromise) {
    exporterModulePromise = import(new URL('../../src/lib/exporters.ts', import.meta.url).href)
  }
  return exporterModulePromise
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
  const {
    createNormalizedOutputs,
    firstLineDiff,
    normalizeJson,
    normalizeJsonl,
    trimLines,
  } = await loadExporterModule()

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

  const goldenArtifacts: GoldenArtifacts = { package: {} }

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

  const comparison = compareNormalizedOutputs(normalized, goldenArtifacts)

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
  const summary = formatComparisonSummary(comparison.entries)
  await writeFile(diffPath, `${summary}\n`, 'utf8')

  const normalizedPath = comparison.ok ? toPosix(relative(process.cwd(), baseDir)) : ''
  const runUri = comparison.ok ? `file://${normalizedPath}` : ''

  const telemetryEvent = createTelemetryEvent(comparison, runId)
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
