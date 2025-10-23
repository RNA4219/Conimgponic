import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { useSB } from '../store'
import { readFileAsText } from '../lib/importers'
import {
  createNormalizedOutputs,
  firstLineDiff,
  normalizeJson,
  normalizeJsonl,
  trimLines,
  type ExportFormat,
  type NormalizedOutputs,
  type TelemetryCollector,
} from '../lib/exporters'

interface GoldenArtifacts {
  readonly markdown?: string
  readonly csv?: string
  readonly jsonl?: string
  readonly package: Record<string, string>
}

interface ArtifactFile {
  readonly format: ExportFormat
  readonly payload: string
  readonly name?: string
}

interface ComparisonEntry {
  readonly format: ExportFormat
  readonly name?: string
  readonly status: 'matched' | 'diff'
  readonly diff?: string
}

interface ComparisonResult {
  readonly entries: ComparisonEntry[]
  readonly summary: string
  readonly matchRate: number
}

type EntryKey = 'markdown' | 'csv' | 'jsonl' | `package:${string}`

type ScalarFormat = Exclude<ExportFormat, 'package'>

const formatLabel: Record<ScalarFormat, string> = {
  markdown: 'Markdown',
  csv: 'CSV',
  jsonl: 'JSONL',
}

function normalizeGoldenPayload(
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

function compareOutputs(actual: NormalizedOutputs, golden: GoldenArtifacts): ComparisonResult {
  const entries: ComparisonEntry[] = []

  for (const format of ['markdown', 'csv', 'jsonl'] as const) {
    const expected = normalizeGoldenPayload(format, golden)
    if (!expected) {
      entries.push({ format, status: 'diff', diff: 'missing golden input' })
      continue
    }
    const actualValue = actual[format]
    if (expected === actualValue) {
      entries.push({ format, status: 'matched' })
    } else {
      entries.push({ format, status: 'diff', diff: firstLineDiff(actualValue, expected) })
    }
  }

  const packageNames = new Set([
    ...Object.keys(actual.package),
    ...Object.keys(golden.package),
  ])
  packageNames.forEach((name) => {
    const actualPayload = actual.package[name]
    if (!actualPayload) {
      entries.push({ format: 'package', name, status: 'diff', diff: 'missing generated artifact' })
      return
    }
    const expected = normalizeGoldenPayload('package', golden, name)
    if (!expected) {
      entries.push({ format: 'package', name, status: 'diff', diff: 'missing golden input' })
      return
    }
    if (expected === actualPayload) {
      entries.push({ format: 'package', name, status: 'matched' })
    } else {
      entries.push({ format: 'package', name, status: 'diff', diff: firstLineDiff(actualPayload, expected) })
    }
  })

  const matchCount = entries.filter((entry) => entry.status === 'matched').length
  const matchRate = entries.length ? matchCount / entries.length : 0

  const summary = entries.length
    ? entries
        .map((entry) =>
          entry.status === 'matched'
            ? `${entry.format}${entry.name ? `:${entry.name}` : ''}: OK`
            : `${entry.format}${entry.name ? `:${entry.name}` : ''}: diff -> ${entry.diff ?? 'mismatch'}`,
        )
        .join('\n')
    : 'No golden artifacts loaded'

  return { entries, summary, matchRate }
}

function detectArtifact(file: File, payload: string): ArtifactFile | null {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
  const lower = relative.toLowerCase()
  if (lower.endsWith('storyboard.md')) {
    return { format: 'markdown', payload }
  }
  if (lower.endsWith('storyboard.csv')) {
    return { format: 'csv', payload }
  }
  if (lower.endsWith('storyboard.jsonl')) {
    return { format: 'jsonl', payload }
  }
  if (lower.endsWith('export-info.json')) {
    return { format: 'package', name: 'export-info.json', payload }
  }
  if (lower.endsWith('storyboard.json')) {
    return { format: 'package', name: 'storyboard.json', payload }
  }
  return null
}

function toEntryKey(entry: ComparisonEntry): EntryKey {
  return (entry.format === 'package' && entry.name
    ? `package:${entry.name}`
    : entry.format) as EntryKey
}

export interface GoldenCompareProps {
  readonly telemetry?: TelemetryCollector
}

export function GoldenCompare({ telemetry }: GoldenCompareProps): JSX.Element {
  const { sb } = useSB()
  const normalized = useMemo(() => createNormalizedOutputs(sb), [sb])
  const [golden, setGolden] = useState<GoldenArtifacts>({ package: {} })
  const comparison = useMemo(() => compareOutputs(normalized, golden), [normalized, golden])
  const entryKeys = useMemo(() => {
    const keys = new Set<EntryKey>()
    comparison.entries.forEach((entry) => {
      keys.add(toEntryKey(entry))
    })
    return Array.from(keys)
  }, [comparison.entries])
  const [selectedKey, setSelectedKey] = useState<EntryKey>('markdown')

  useEffect(() => {
    if (!entryKeys.length) {
      return
    }
    if (!entryKeys.includes(selectedKey)) {
      setSelectedKey(entryKeys[0])
    }
  }, [entryKeys, selectedKey])

  const selectedEntry = useMemo(
    () =>
      comparison.entries.find((entry) => toEntryKey(entry) === selectedKey) ??
      comparison.entries[0],
    [comparison.entries, selectedKey],
  )

  const normalizedGolden = useMemo(() => {
    if (!selectedEntry) return undefined
    return normalizeGoldenPayload(selectedEntry.format, golden, selectedEntry.name)
  }, [golden, selectedEntry])

  const telemetrySummaryRef = useRef<string | null>(null)
  useEffect(() => {
    if (!telemetry || !comparison.entries.length) {
      return
    }
    if (telemetrySummaryRef.current === comparison.summary) {
      return
    }
    telemetrySummaryRef.current = comparison.summary
    const allMatched = comparison.entries.every((entry) => entry.status === 'matched')
    const formats = Array.from(
      new Set(
        comparison.entries.map((entry) =>
          entry.format === 'package' && entry.name ? `package:${entry.name}` : entry.format,
        ),
      ),
    )
    const payload: Record<string, unknown> = {
      runId: 'ui-preview',
      matchRate: comparison.matchRate,
      entries: comparison.entries.map((entry) => ({
        format: entry.format,
        name: entry.name ?? null,
        status: entry.status,
        diff: entry.diff ?? null,
      })),
    }
    if (allMatched) {
      payload.formats = formats
      telemetry.track('export.success', payload)
    } else {
      payload.retryable = false
      payload.formats = formats
      telemetry.track('export.failed', payload)
    }
  }, [comparison, telemetry])

  const handleFiles = useCallback(async (fileList: FileList) => {
    const files = Array.from(fileList)
    const artifacts: ArtifactFile[] = []
    for (const file of files) {
      const payload = await readFileAsText(file)
      const artifact = detectArtifact(file, payload)
      if (artifact) {
        artifacts.push(artifact)
      }
    }
    if (!artifacts.length) {
      return
    }
    setGolden((prev) => {
      const next: GoldenArtifacts = {
        markdown: prev.markdown,
        csv: prev.csv,
        jsonl: prev.jsonl,
        package: { ...prev.package },
      }
      artifacts.forEach((artifact) => {
        if (artifact.format === 'package' && artifact.name) {
          next.package[artifact.name] = artifact.payload
        } else if (artifact.format !== 'package') {
          next[artifact.format] = artifact.payload
        }
      })
      return next
    })
  }, [])

  const actualText = useMemo(() => {
    if (!selectedEntry) return ''
    if (selectedEntry.format === 'package') {
      return selectedEntry.name ? normalized.package[selectedEntry.name] ?? '' : ''
    }
    return normalized[selectedEntry.format]
  }, [normalized, selectedEntry])

  return (
    <div style={{ padding: 8, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="file"
          multiple
          onChange={async (event) => {
            const files = event.target.files
            if (!files) return
            await handleFiles(files)
            event.target.value = ''
          }}
        />
        <span>一致率: {(comparison.matchRate * 100).toFixed(1)}%</span>
      </div>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{comparison.summary}</pre>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          比較対象:
          <select value={selectedKey} onChange={(event) => setSelectedKey(event.target.value as EntryKey)}>
            {entryKeys.map((key) => {
              if (key === 'markdown' || key === 'csv' || key === 'jsonl') {
                return (
                  <option key={key} value={key}>
                    {formatLabel[key]}
                  </option>
                )
              }
              const name = key.slice('package:'.length)
              return (
                <option key={key} value={key}>{`package:${name}`}</option>
              )
            })}
          </select>
        </label>
        {selectedEntry && selectedEntry.status === 'diff' ? (
          <span style={{ color: '#c00' }}>{selectedEntry.diff ?? 'diff'}</span>
        ) : null}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <h4 style={{ margin: '0 0 4px' }}>Normalized (現在)</h4>
          <pre style={{ margin: 0 }}>{actualText}</pre>
        </div>
        <div>
          <h4 style={{ margin: '0 0 4px' }}>Normalized (Golden)</h4>
          <pre style={{ margin: 0 }}>{normalizedGolden ?? '(未読み込み)'}</pre>
        </div>
      </div>
    </div>
  )
}
