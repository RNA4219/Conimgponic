import { firstLineDiff, normalizeJson, normalizeJsonl, trimLines } from '../exporters'

import { COLLECT_METRICS_CONTRACT } from '../../../scripts/monitor/collect-metrics'

import type { ExportFormat, NormalizedOutputs } from '../exporters'

const textEncoder = new TextEncoder()

const measureArtifactBytes = (payload: string): number =>
  textEncoder.encode(`${payload}\n`).byteLength

export interface GoldenArtifacts {
  readonly markdown?: string
  readonly csv?: string
  readonly jsonl?: string
  readonly package: Record<string, string>
}

export interface GoldenComparisonEntry {
  readonly format: ExportFormat
  readonly name?: string
  readonly status: 'matched' | 'diff'
  readonly diff?: string
  readonly bytes?: number
}

export interface GoldenComparisonResult {
  readonly entries: GoldenComparisonEntry[]
  readonly matchRate: number
  readonly ok: boolean
  readonly error?: { message: string; retryable: boolean }
}

export interface ExportTelemetryDetail {
  readonly duration_ms: number
}

type ScalarFormat = Exclude<ExportFormat, 'package'>

const scalarFormats: readonly ScalarFormat[] = ['markdown', 'csv', 'jsonl']

const clampAttempt = (value: number | undefined): number => {
  const retryPolicy = COLLECT_METRICS_CONTRACT.telemetry.retryPolicy
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 1
  }
  const normalized = Math.floor(value)
  const clamped = Math.max(1, normalized)
  return Math.min(clamped, retryPolicy.maxAttempts)
}

const resolveNextBackoffMs = (attempt: number | undefined): number => {
  const retryPolicy = COLLECT_METRICS_CONTRACT.telemetry.retryPolicy
  const schedule = retryPolicy.backoffMs
  if (!schedule.length) {
    return 0
  }
  const index = Math.min(clampAttempt(attempt) - 1, schedule.length - 1)
  const candidate = schedule[index]
  if (typeof candidate !== 'number' || Number.isNaN(candidate) || candidate < 0) {
    return 0
  }
  return candidate
}

function buildNormalizedPath(entry: GoldenComparisonEntry, runId: string): string | null {
  const base = `runs/${runId}/export`
  if (entry.format === 'package') {
    if (!entry.name) return null
    return `${base}/package/${entry.name}`
  }
  const extension = entry.format === 'markdown' ? 'md' : entry.format
  return `${base}/${entry.format}/storyboard.${extension}`
}

export function normalizeGoldenArtifact(
  format: ExportFormat,
  golden: GoldenArtifacts,
  name?: string,
): string | undefined {
  switch (format) {
    case 'markdown':
      return golden.markdown ? trimLines(golden.markdown) : undefined
    case 'csv':
      return golden.csv ? trimLines(golden.csv) : undefined
    case 'jsonl':
      return golden.jsonl ? normalizeJsonl(golden.jsonl) : undefined
    case 'package':
      if (!name) return undefined
      return golden.package[name] ? normalizeJson(golden.package[name]) : undefined
    default:
      return undefined
  }
}

export function compareNormalizedOutputs(
  actual: NormalizedOutputs,
  golden: GoldenArtifacts,
): GoldenComparisonResult {
  const entries: GoldenComparisonEntry[] = []

  scalarFormats.forEach((format) => {
    const actualPayload = actual[format]
    const artifactBytes = measureArtifactBytes(actualPayload)
    const expected = normalizeGoldenArtifact(format, golden)
    if (!expected) {
      entries.push({ format, status: 'diff', diff: 'missing golden input', bytes: artifactBytes })
      return
    }
    if (expected === actualPayload) {
      entries.push({ format, status: 'matched', bytes: artifactBytes })
    } else {
      entries.push({
        format,
        status: 'diff',
        diff: firstLineDiff(actualPayload, expected),
        bytes: artifactBytes,
      })
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
    const artifactBytes = measureArtifactBytes(actualPayload)
    const expected = normalizeGoldenArtifact('package', golden, name)
    if (!expected) {
      entries.push({
        format: 'package',
        name,
        status: 'diff',
        diff: 'missing golden input',
        bytes: artifactBytes,
      })
      return
    }
    if (expected === actualPayload) {
      entries.push({ format: 'package', name, status: 'matched', bytes: artifactBytes })
    } else {
      entries.push({
        format: 'package',
        name,
        status: 'diff',
        diff: firstLineDiff(actualPayload, expected),
        bytes: artifactBytes,
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

export function formatComparisonSummary(entries: readonly GoldenComparisonEntry[]): string {
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

export function createTelemetryEvent(
  comparison: GoldenComparisonResult,
  runId: string,
  detail: ExportTelemetryDetail,
  attempt?: number,
): { event: 'export.result'; payload: Record<string, unknown> } | null {
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
  const durationMs = Math.max(0, Math.round(detail.duration_ms))

  const artifacts = comparison.entries.map((entry) => ({
    format: entry.format,
    name: entry.name ?? null,
    status: entry.status,
    uri: null,
    normalizedPath: buildNormalizedPath(entry, runId),
    durationMs: null,
    bytes: entry.bytes ?? null,
  }))

  const basePayload: Record<string, unknown> = {
    status: comparison.ok ? 'success' : 'failure',
    runId,
    matchRate: comparison.matchRate,
    formats,
    duration_ms: durationMs,
    detail: { duration_ms: durationMs },
    artifacts,
  }

  if (!comparison.ok) {
    const retryable = comparison.error?.retryable ?? false
    basePayload.error = {
      code: 'golden.comparison_failed',
      retryable,
      message: comparison.error?.message ?? 'Golden comparison failed',
    }
    basePayload.entries = comparison.entries.map((entry) => ({
      format: entry.format,
      name: entry.name ?? null,
      status: entry.status,
      diff: entry.diff ?? null,
    }))
    basePayload.next_backoff_ms = resolveNextBackoffMs(attempt)
  }

  return { event: 'export.result', payload: basePayload }
}

export type { GoldenComparisonEntry as ComparisonEntry }
