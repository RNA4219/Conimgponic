import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { useSB } from '../store'
import { readFileAsText } from '../lib/importers'
import { createNormalizedOutputs, type ExportFormat, type TelemetryCollector } from '../lib/exporters'
import {
  compareNormalizedOutputs,
  createTelemetryEvent,
  formatComparisonSummary,
  normalizeGoldenArtifact,
  type ComparisonEntry,
  type GoldenArtifacts,
} from '../lib/golden/compare'

interface ArtifactFile {
  readonly format: ExportFormat
  readonly payload: string
  readonly name?: string
}

type EntryKey = 'markdown' | 'csv' | 'jsonl' | `package:${string}`

type ScalarFormat = Exclude<ExportFormat, 'package'>

const formatLabel: Record<ScalarFormat, string> = {
  markdown: 'Markdown',
  csv: 'CSV',
  jsonl: 'JSONL',
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
  const comparison = useMemo(
    () => compareNormalizedOutputs(normalized, golden),
    [normalized, golden],
  )
  const summary = useMemo(() => formatComparisonSummary(comparison.entries), [comparison.entries])
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
    return normalizeGoldenArtifact(selectedEntry.format, golden, selectedEntry.name)
  }, [golden, selectedEntry])

  const telemetrySummaryRef = useRef<string | null>(null)
  useEffect(() => {
    if (!telemetry || !comparison.entries.length) {
      return
    }
    if (telemetrySummaryRef.current === summary) {
      return
    }
    telemetrySummaryRef.current = summary
    const event = createTelemetryEvent(comparison, 'ui-preview')
    if (event) {
      telemetry.track(event.event, event.payload)
    }
  }, [comparison, summary, telemetry])

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
      const cloned = structuredClone(prev)
      const nextPackage = { ...cloned.package }
      let nextMarkdown = cloned.markdown
      let nextCsv = cloned.csv
      let nextJsonl = cloned.jsonl

      artifacts.forEach((artifact) => {
        if (artifact.format === 'package' && artifact.name) {
          nextPackage[artifact.name] = artifact.payload
          return
        }
        if (artifact.format === 'markdown') {
          nextMarkdown = artifact.payload
          return
        }
        if (artifact.format === 'csv') {
          nextCsv = artifact.payload
          return
        }
        if (artifact.format === 'jsonl') {
          nextJsonl = artifact.payload
        }
      })

      return {
        markdown: nextMarkdown,
        csv: nextCsv,
        jsonl: nextJsonl,
        package: nextPackage,
      } as GoldenArtifacts
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
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{summary}</pre>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span>結果: {comparison.ok ? '✅ Golden 一致' : '❌ 差分あり'}</span>
        <span>
          再実行可否:
          {comparison.error ? (comparison.error.retryable ? '再実行可能' : '再実行不可') : '検証済み'}
        </span>
      </div>
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
