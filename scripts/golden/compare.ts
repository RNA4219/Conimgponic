/// <reference types="node" />
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Storyboard } from '../../src/types'
import type { ExportFormat, TelemetryCollector } from '../../src/lib/exporters'
import type {
  GoldenArtifacts,
  GoldenComparisonEntry,
  GoldenComparisonResult,
} from '../../src/lib/golden/compare'

type ExporterModule = typeof import('../../src/lib/exporters')
type GoldenCompareModule = typeof import('../../src/lib/golden/compare')

type ComparisonToolkit = Pick<
  GoldenCompareModule,
  'normalizeGoldenArtifact' | 'compareNormalizedOutputs' | 'formatComparisonSummary' | 'createTelemetryEvent'
>

let exporterModulePromise: Promise<ExporterModule> | null = null
let goldenCompareModulePromise: Promise<GoldenCompareModule> | null = null
let comparisonToolkitPromise: Promise<ComparisonToolkit> | null = null

const EXPORT_DIR = 'export'

async function loadExporterModule(): Promise<ExporterModule> {
  if (!exporterModulePromise) {
    exporterModulePromise = import(new URL('../../src/lib/exporters.ts', import.meta.url).href)
  }
  return exporterModulePromise
}

async function loadGoldenCompareModule(): Promise<GoldenCompareModule> {
  if (!goldenCompareModulePromise) {
    goldenCompareModulePromise = import(new URL('../../src/lib/golden/compare.ts', import.meta.url).href)
  }
  return goldenCompareModulePromise
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
  name?: string
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
  const exporterModule = await loadExporterModule()
  const { createNormalizedOutputs } = exporterModule
  const toolkit = await loadComparisonToolkit()

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

  const scalarGoldenArtifacts: Partial<Record<Exclude<ExportFormat, 'package'>, string>> = {}

  const expectedPaths: Record<Exclude<ExportFormat, 'package'>, string> = {
    markdown: join(options.goldenDir, 'markdown', 'storyboard.md'),
    csv: join(options.goldenDir, 'csv', 'storyboard.csv'),
    jsonl: join(options.goldenDir, 'jsonl', 'storyboard.jsonl'),
  }

  for (const format of ['markdown', 'csv', 'jsonl'] as const) {
    const expectedPath = expectedPaths[format]
    if (existsSync(expectedPath)) {
      scalarGoldenArtifacts[format] = await readExpected(expectedPath)
    }
  }

  const packageGoldenArtifacts: Record<string, string> = {}
  if (existsSync(packageDir)) {
    for (const name of await readdir(packageDir)) {
      const target = join(packageDir, name)
      if (existsSync(target)) {
        packageGoldenArtifacts[name] = await readExpected(target)
      }
    }
  }

  const goldenArtifacts: GoldenArtifacts = {
    package: packageGoldenArtifacts,
    ...scalarGoldenArtifacts,
  }

  const comparison = toolkit.compareNormalizedOutputs(normalized, goldenArtifacts)

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
      name: entry.name,
      expectedPath,
      actualPath,
      status: entry.status,
      diff: entry.diff,
    }
  }

  entries.push(...comparison.entries.map(toCompareEntry))

  const diffPath = ensureDiffPath(options.outputDir)
  const summary = toolkit.formatComparisonSummary(comparison.entries)
  await writeFile(diffPath, `${summary}\n`, 'utf8')

  const diffReportRelative = relative(process.cwd(), diffPath) || diffPath
  const diffReportPosix = toPosix(diffReportRelative)
  const normalizedRelative = relative(process.cwd(), baseDir) || baseDir
  const normalizedPosix = toPosix(normalizedRelative)
  const logSummaryLines = summary.split('\n')
  const statusLabel = comparison.ok ? 'OK' : 'DIFF'
  console.info(`[golden] comparison ${statusLabel}`)
  for (const line of logSummaryLines) {
    console.info(`[golden]   ${line}`)
  }
  console.info(`[golden] diff report: ${diffReportPosix}`)
  console.info(`[golden] normalized outputs: ${normalizedPosix}`)

  const normalizedPath = comparison.ok ? normalizedPosix : ''
  const runUri = comparison.ok ? pathToFileURL(baseDir).href : ''

  const telemetryEvent = toolkit.createTelemetryEvent(comparison, runId)
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

export async function loadComparisonToolkit(): Promise<ComparisonToolkit> {
  if (!comparisonToolkitPromise) {
    comparisonToolkitPromise = loadGoldenCompareModule().then((module) => ({
      normalizeGoldenArtifact: module.normalizeGoldenArtifact,
      compareNormalizedOutputs: module.compareNormalizedOutputs,
      formatComparisonSummary: module.formatComparisonSummary,
      createTelemetryEvent: module.createTelemetryEvent,
    }))
  }
  return comparisonToolkitPromise
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

export type {
  GoldenArtifacts,
  GoldenComparisonEntry,
  GoldenComparisonResult,
} from '../../src/lib/golden/compare'
