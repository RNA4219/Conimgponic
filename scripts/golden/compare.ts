/// <reference types="node" />
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'

import type { Storyboard } from '../../src/types'
import type {
  ExportFormat,
  NormalizedOutputs,
  PackageArtifacts,
  TelemetryCollector,
} from '../../src/lib/exporters'

type ExporterModule = typeof import('../../src/lib/exporters')

let exporterModulePromise: Promise<ExporterModule> | null = null

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

const EXPORT_DIR = 'export'

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
