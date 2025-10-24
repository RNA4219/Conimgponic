import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { strict as assert } from 'node:assert'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

process.env.TS_NODE_COMPILER_OPTIONS ??= JSON.stringify({ moduleResolution: 'bundler' })

import type { Storyboard } from '../../src/types'
import type { GoldenArtifacts as ModuleGoldenArtifacts } from '../../src/lib/golden/compare'
type CompareModule = typeof import('../../scripts/golden/compare')
const compareModulePromise = import(
  pathToFileURL(join(process.cwd(), 'scripts/golden/compare.ts')).href
) as Promise<CompareModule>

type GoldenCompareModule = typeof import('../../src/lib/golden/compare')
const goldenCompareModulePromise: Promise<GoldenCompareModule> = import(
  pathToFileURL(join(process.cwd(), 'src/lib/golden/compare.ts')).href,
).catch(async (error) => {
  const compare = await loadCompareModule()
  if ('loadComparisonToolkit' in compare) {
    const toolkit = await compare.loadComparisonToolkit()
    return toolkit as unknown as GoldenCompareModule
  }
  throw error
})

type ExportersModule = typeof import('../../src/lib/exporters')
const exportersModulePromise = import(
  pathToFileURL(join(process.cwd(), 'src/lib/exporters.ts')).href
) as Promise<ExportersModule>

async function loadExporters(): Promise<ExportersModule> {
  return exportersModulePromise
}

type NormalizedOutputs = {
  markdown: string
  csv: string
  jsonl: string
  package: Record<string, string>
}
type Mutator = (outputs: NormalizedOutputs) => void

const storyboardPath = join(process.cwd(), 'tests/fixtures/case-mini-03/project.storyboard.json')
const baseStoryboard = JSON.parse(readFileSync(storyboardPath, 'utf8')) as Storyboard

type GoldenArtifacts = import('../../src/lib/golden/compare').GoldenArtifacts
type GoldenComparisonEntry = import('../../src/lib/golden/compare').GoldenComparisonEntry
type GoldenComparisonResult = import('../../src/lib/golden/compare').GoldenComparisonResult
type ExporterTools = Awaited<ReturnType<typeof loadExporters>>
type NormalizedOutputsType = import('../../src/lib/exporters').NormalizedOutputs
type Mutable<T> = { -readonly [P in keyof T]: T[P] }
type NormalizationTools = Pick<ExporterTools, 'firstLineDiff' | 'normalizeJson' | 'normalizeJsonl' | 'trimLines'>
type ScalarFormat = Exclude<keyof Pick<NormalizedOutputsType, 'markdown' | 'csv' | 'jsonl'>, 'package'>

const scalarFormats: readonly ScalarFormat[] = ['markdown', 'csv', 'jsonl']

function normalizeGoldenArtifact(
  format: keyof NormalizedOutputsType | 'package',
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

async function loadGoldenCompareModule(): Promise<GoldenCompareModule> {
  try {
    return await goldenCompareModulePromise
  } catch (error) {
    const compare = await loadCompareModule()
    if ('loadComparisonToolkit' in compare) {
      const toolkit = await compare.loadComparisonToolkit()
      return toolkit as unknown as GoldenCompareModule
    }
    throw error
  }
}

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function writeText(pathname: string, payload: string): void {
  mkdirSync(dirname(pathname), { recursive: true })
  writeFileSync(pathname, `${payload}\n`, 'utf8')
}

function writeOutputs(dir: string, outputs: NormalizedOutputs): void {
  writeText(join(dir, 'markdown', 'storyboard.md'), outputs.markdown)
  writeText(join(dir, 'csv', 'storyboard.csv'), outputs.csv)
  writeText(join(dir, 'jsonl', 'storyboard.jsonl'), outputs.jsonl)
  for (const [name, payload] of Object.entries(outputs.package)) {
    writeText(join(dir, 'package', name), payload)
  }
}

async function setupGolden(mutate?: Mutator): Promise<{
  goldenDir: string
  outputDir: string
  cleanup: () => void
  compare: CompareModule
}> {
  const exporters = await loadExporters()
  const goldenDir = createTempDir('golden-fixture-')
  const outputDir = createTempDir('golden-output-')
  const compare = await loadCompareModule()
  const outputs = exporters.createNormalizedOutputs(baseStoryboard)
  mutate?.(outputs)
  writeOutputs(goldenDir, outputs)
  return {
    goldenDir,
    outputDir,
    compare,
    cleanup: () => {
      rmSync(goldenDir, { recursive: true, force: true })
      rmSync(outputDir, { recursive: true, force: true })
    },
  }
}

function makeTelemetryCollector(): {
  events: Array<{ event: string; payload: Record<string, unknown> }>
  track: (event: 'export.success' | 'export.failed', payload: Record<string, unknown>) => void
} {
  const events: Array<{ event: string; payload: Record<string, unknown> }> = []
  return {
    events,
    track(event, payload) {
      events.push({ event, payload })
    },
  }
}

describe('export bridge golden comparison', () => {
  test('UI 側エクスポート結果が createNormalizedOutputs と同一の正規化結果を返す', async () => {
    const exporters = await loadExporters()
    const normalized = exporters.createNormalizedOutputs(baseStoryboard)
    assert.equal(exporters.toMarkdown(baseStoryboard), normalized.markdown)
    assert.equal(exporters.toCSV(baseStoryboard), normalized.csv)
    assert.equal(exporters.toJSONL(baseStoryboard), normalized.jsonl)
  })

  test('Markdown エクスポートを正規化し runs/<runId>/export/markdown/storyboard.md とゴールデンを厳密比較する', async () => {
    const ctx = await setupGolden()
    try {
      const { compareStoryboardToGolden } = ctx.compare
      const result = await compareStoryboardToGolden({
        storyboardPath,
        goldenDir: ctx.goldenDir,
        outputDir: ctx.outputDir,
        runId: 'unit',
      })
      assert.equal(result.ok, true)
      const markdownEntry = result.entries.find((entry) => entry.format === 'markdown')
      assert.ok(markdownEntry)
      assert.equal(markdownEntry.status, 'matched')
      const diffReport = readFileSync(result.diffPath, 'utf8')
      assert.match(diffReport, /markdown: OK/)
      assert.equal(result.normalizedPath, 'runs/unit/export')
      assert.equal(
        result.runUri,
        pathToFileURL(join(ctx.outputDir, 'runs', 'unit', 'export')).href,
        'runUri は file://runs/... ではなく絶対 file:// URI を返す必要がある',
      )
    } finally {
      ctx.cleanup()
    }
  })

  test('CSV エクスポートを RFC4180 正規化後に runs/<runId>/export/csv/storyboard.csv とゴールデンで比較する', async () => {
    const ctx = await setupGolden((outputs) => {
      outputs.csv = `${outputs.csv}\n"corrupted"`
    })
    try {
      const { compareStoryboardToGolden } = ctx.compare
      const result = await compareStoryboardToGolden({
        storyboardPath,
        goldenDir: ctx.goldenDir,
        outputDir: ctx.outputDir,
        runId: 'unit',
      })
      assert.equal(result.ok, false)
      const csvEntry = result.entries.find((entry) => entry.format === 'csv')
      assert.ok(csvEntry)
      assert.equal(csvEntry.status, 'diff')
      assert.match(csvEntry.diff ?? '', /corrupted/)
      const diffReport = readFileSync(result.diffPath, 'utf8')
      assert.match(diffReport, /csv: diff -> line/)
    } finally {
      ctx.cleanup()
    }
  })

  test('compare.ts CLI は diff サマリを標準出力へ書き出す', async () => {
    const { goldenDir, outputDir, cleanup } = await setupGolden((outputs) => {
      outputs.csv = `${outputs.csv}\n"corrupted"`
    })
    try {
      const comparePath = join(process.cwd(), 'scripts/golden/compare.ts')
      const result = spawnSync(process.execPath, [
        '--loader',
        'ts-node/esm',
        comparePath,
        storyboardPath,
        goldenDir,
        outputDir,
      ], {
        encoding: 'utf8',
      })
      assert.equal(result.status, 1)
      assert.match(result.stdout, /\[golden\]\s+csv: diff/)
      assert.match(result.stdout, /golden-diff\.txt/)
    } finally {
      cleanup()
    }
  })

  test('JSONL エクスポートをキー順固定で正規化し runs/<runId>/export/jsonl/storyboard.jsonl と比較する', async () => {
    const ctx = await setupGolden((outputs) => {
      outputs.jsonl = outputs.jsonl
        .split('\n')
        .map((line) => {
          const parsed = JSON.parse(line) as Record<string, unknown>
          const reversed = Object.entries(parsed).reverse()
          return JSON.stringify(Object.fromEntries(reversed))
        })
        .join('\n')
    })
    try {
      const { compareStoryboardToGolden } = ctx.compare
      const result = await compareStoryboardToGolden({
        storyboardPath,
        goldenDir: ctx.goldenDir,
        outputDir: ctx.outputDir,
        runId: 'unit',
      })
      assert.equal(result.ok, true)
      const jsonlEntry = result.entries.find((entry) => entry.format === 'jsonl')
      assert.ok(jsonlEntry)
      assert.equal(jsonlEntry.status, 'matched')
    } finally {
      ctx.cleanup()
    }
  })

  test('Package エクスポートを展開し内包ファイルおよび export-info.json をゴールデンと比較する', async () => {
    const ctx = await setupGolden((outputs) => {
      delete outputs.package['export-info.json']
    })
    try {
      const { compareStoryboardToGolden } = ctx.compare
      const result = await compareStoryboardToGolden({
        storyboardPath,
        goldenDir: ctx.goldenDir,
        outputDir: ctx.outputDir,
        runId: 'unit',
      })
      assert.equal(result.ok, false)
      const packageEntries = result.entries.filter((entry) => entry.format === 'package')
      assert.ok(packageEntries.some((entry) => entry.status === 'diff'))
      assert.ok(packageEntries.some((entry) => entry.diff?.includes('missing golden')))
    } finally {
      ctx.cleanup()
    }
  })

  test('export.result が URI と normalized パスを返し、失敗時は { ok:false,error } で retryable を検証する', async () => {
    const ctx = await setupGolden((outputs) => {
      outputs.markdown = `${outputs.markdown}\n## Broken`
    })
    try {
      const { compareStoryboardToGolden } = ctx.compare
      const result = await compareStoryboardToGolden({
        storyboardPath,
        goldenDir: ctx.goldenDir,
        outputDir: ctx.outputDir,
        runId: 'unit',
      })
      assert.equal(result.ok, false)
      assert.equal(result.runUri, '')
      assert.equal(result.normalizedPath, '')
      assert.ok(result.error)
      assert.equal(result.error?.retryable, false)
    } finally {
      ctx.cleanup()
    }
  })

  test('AutoSave ロック競合やフォーマット未対応時のエラーが Collector へ telemetry export.failed として送信される', async () => {
    const ctx = await setupGolden((outputs) => {
      outputs.csv = `${outputs.csv},oops`
    })
    const telemetry = makeTelemetryCollector()
    try {
      const { compareStoryboardToGolden } = ctx.compare
      const result = await compareStoryboardToGolden({
        storyboardPath,
        goldenDir: ctx.goldenDir,
        outputDir: ctx.outputDir,
        runId: 'unit',
        telemetry,
      })
      assert.equal(result.ok, false)
      const failed = telemetry.events.find((event) => event.event === 'export.failed')
      assert.ok(failed)
      assert.equal(failed.payload.retryable, false)
    } finally {
      ctx.cleanup()
    }
  })

  test('UI で用いる比較ユーティリティが CI の diff サマリと完全一致する', async () => {
    const ctx = await setupGolden((outputs) => {
      outputs.csv = `${outputs.csv}\n"corrupted"`
    })
    try {
      const { compareStoryboardToGolden } = ctx.compare
      const compareResult = await compareStoryboardToGolden({
        storyboardPath,
        goldenDir: ctx.goldenDir,
        outputDir: ctx.outputDir,
        runId: 'unit',
      })
      assert.equal(compareResult.ok, false)

      const exporters = await loadExporters()
      const normalized = exporters.createNormalizedOutputs(baseStoryboard)
      const tools: NormalizationTools = {
        firstLineDiff: exporters.firstLineDiff,
        normalizeJson: exporters.normalizeJson,
        normalizeJsonl: exporters.normalizeJsonl,
        trimLines: exporters.trimLines,
      }

      const goldenArtifacts = readGoldenArtifacts(ctx.goldenDir)
      const comparison = compareWithGolden(normalized, goldenArtifacts, tools)

      assert.equal(comparison.ok, false)
      const diffReport = readFileSync(compareResult.diffPath, 'utf8').trimEnd()
      assert.equal(summarizeComparison(comparison.entries), diffReport)
      const csvEntry = comparison.entries.find((entry) => entry.format === 'csv')
      assert.ok(csvEntry)
      assert.equal(csvEntry.status, 'diff')
      assert.match(csvEntry.diff ?? '', /corrupted/)
    } finally {
      ctx.cleanup()
    }
  })
})

function readGoldenArtifacts(dir: string): ModuleGoldenArtifacts {
  const markdownPath = join(dir, 'markdown', 'storyboard.md')
  const csvPath = join(dir, 'csv', 'storyboard.csv')
  const jsonlPath = join(dir, 'jsonl', 'storyboard.jsonl')
  const artifacts: { markdown?: string; csv?: string; jsonl?: string; package: Record<string, string> } = {
    package: {},
  }
  if (existsSync(markdownPath)) {
    artifacts.markdown = readFileSync(markdownPath, 'utf8')
  }
  if (existsSync(csvPath)) {
    artifacts.csv = readFileSync(csvPath, 'utf8')
  }
  if (existsSync(jsonlPath)) {
    artifacts.jsonl = readFileSync(jsonlPath, 'utf8')
  }
  const packageDir = join(dir, 'package')
  if (existsSync(packageDir)) {
    for (const name of readdirSync(packageDir)) {
      const target = join(packageDir, name)
      if (existsSync(target)) {
        artifacts.package[name] = readFileSync(target, 'utf8')
      }
    }
  }
  return artifacts
}
