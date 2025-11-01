import { ensureDir, loadJSON, loadText, saveJSON, saveText } from '../opfs.js'

import type { AutoSaveError, AutoSaveErrorCode } from '../autosave.js'
import { AUTOSAVE_DEFAULTS } from './policy.js'
import type { AutoSavePolicy } from './policy.js'

export interface AutoSaveHistoryEntry {
  readonly ts: string
  readonly bytes: number
  readonly location: 'current' | 'history'
  readonly retained: boolean
}

export interface AutoSaveHistoryRotationPlan {
  readonly targetDirectory: string
  readonly indexFile: string
  readonly currentFile: string
  readonly maxGenerations: number
  readonly maxBytes: number
  readonly gcOrder: 'fifo'
  readonly cleanupOrphans: boolean
}

export const AUTOSAVE_HISTORY_ROTATION_PLAN: AutoSaveHistoryRotationPlan = Object.freeze({
  targetDirectory: 'project/autosave',
  indexFile: 'project/autosave/index.json',
  currentFile: 'project/autosave/current.json',
  maxGenerations: AUTOSAVE_DEFAULTS.maxGenerations,
  maxBytes: AUTOSAVE_DEFAULTS.maxBytes,
  gcOrder: 'fifo',
  cleanupOrphans: true
})

const AUTOSAVE_DIRECTORY = AUTOSAVE_HISTORY_ROTATION_PLAN.targetDirectory
const CURRENT_PATH = AUTOSAVE_HISTORY_ROTATION_PLAN.currentFile
const INDEX_PATH = AUTOSAVE_HISTORY_ROTATION_PLAN.indexFile
const HISTORY_DIRECTORY = `${AUTOSAVE_DIRECTORY}/history`

export const sanitizeTimestamp = (ts: string): string => ts.replace(/[:.]/g, '-')

export interface AutoSaveIndexPayload {
  readonly current: AutoSaveHistoryEntry | null
  readonly history: readonly AutoSaveHistoryEntry[]
  readonly generation: number | null
}

export interface AutoSavePersistenceDependencies {
  readonly makeError: (
    code: AutoSaveErrorCode,
    message: string,
    retryable: boolean,
    cause?: unknown,
    context?: Record<string, unknown>
  ) => AutoSaveError
}

export interface AutoSaveIndexUpdateInput {
  readonly ts: string
  readonly payload: string
  readonly bytes: number
  readonly generation: number
  readonly policy: Pick<AutoSavePolicy, 'maxGenerations' | 'maxBytes'>
}

export interface AutoSaveIndexUpdateResult {
  readonly history: AutoSaveHistoryEntry[]
  readonly totalBytes: number
  readonly evicted: number
}

export interface AutoSavePersistenceContract {
  readonly loadIndex: () => Promise<AutoSaveIndexPayload>
  readonly writeCurrent: (payload: string) => Promise<{ bytes: number }>
  readonly persistHistory: (input: AutoSaveIndexUpdateInput) => Promise<AutoSaveIndexUpdateResult>
  readonly readCurrent: () => Promise<string | null>
  readonly readHistory: (ts: string) => Promise<string | null>
}

const parseIndexFile = (value: unknown): AutoSaveIndexPayload => {
  if (!value || typeof value !== 'object') return { current: null, history: [], generation: null }
  const input = value as Record<string, unknown>
  const current = input.current as AutoSaveHistoryEntry | null | undefined
  const history = Array.isArray(input.history) ? (input.history as AutoSaveHistoryEntry[]) : []
  const generation = input.generation
  const normalizedGeneration =
    typeof generation === 'number' && Number.isFinite(generation)
      ? Math.max(0, Math.trunc(generation))
      : null
  return {
    current: current && current.location === 'current'
      ? { ...current, retained: current.retained !== false, location: 'current' as const }
      : null,
    history: history
      .filter((entry) => entry?.location === 'history')
      .map((entry) => ({ ...entry, retained: entry.retained !== false, location: 'history' as const })),
    generation: normalizedGeneration
  }
}

const removeFile = async (path: string): Promise<void> => {
  const segs = path.split('/').filter(Boolean)
  const name = segs.pop()
  if (!name) {
    return
  }
  try {
    await (await ensureDir(segs.join('/'))).removeEntry(name)
  } catch (removeError) {
    if (removeError instanceof DOMException && removeError.name === 'NotFoundError') {
      return
    }
    console.warn('Failed to remove autosave artefact', removeError)
  }
}

export const createAutoSavePersistence = (
  deps: AutoSavePersistenceDependencies
): AutoSavePersistenceContract => {
  const encoder = new TextEncoder()

  const renameFile = async (tmp: string, target: string): Promise<void> => {
    const data = await loadText(tmp)
    if (data == null) throw deps.makeError('write-failed', `Missing artefact ${tmp}`, true)
    const segments = target.split('/').filter(Boolean)
    segments.pop()
    if (segments.length > 0) {
      await ensureDir(segments.join('/'))
    }
    await saveText(target, data)
    await removeFile(tmp)
  }

  const loadIndex = async (): Promise<AutoSaveIndexPayload> => {
    const text = await loadText(INDEX_PATH)
    if (!text) return { current: null, history: [], generation: null }
    try {
      return parseIndexFile(JSON.parse(text))
    } catch (error) {
      throw deps.makeError('data-corrupted', 'Failed to parse autosave index', false, error)
    }
  }

  const writeCurrent = async (payload: string): Promise<{ bytes: number }> => {
    const tmp = `${CURRENT_PATH}.tmp`
    const bytes = encoder.encode(payload).length
    await saveText(tmp, payload)
    await renameFile(tmp, CURRENT_PATH)
    return { bytes }
  }

  const persistHistory = async (
    input: AutoSaveIndexUpdateInput
  ): Promise<AutoSaveIndexUpdateResult> => {
    const { ts, payload, bytes, generation, policy } = input
    const tmp = `${INDEX_PATH}.tmp`
    const historyKey = sanitizeTimestamp(ts)
    const rawIndex = await loadJSON(INDEX_PATH)
    const parsed = parseIndexFile(rawIndex)
    const seen = new Set<string>()
    const history: AutoSaveHistoryEntry[] = []
    const pushHistory = (entry: AutoSaveHistoryEntry | null | undefined) => {
      if (!entry || entry.ts === ts || seen.has(entry.ts)) return
      seen.add(entry.ts)
      history.push({ ts: entry.ts, bytes: entry.bytes, location: 'history', retained: entry.retained !== false })
    }
    parsed.history.forEach((entry) => pushHistory(entry))
    if (parsed.current) {
      pushHistory({
        ts: parsed.current.ts,
        bytes: parsed.current.bytes,
        location: 'history',
        retained: parsed.current.retained
      })
    }
    if (
      rawIndex &&
      typeof rawIndex === 'object' &&
      Array.isArray((rawIndex as { entries?: unknown }).entries)
    ) {
      for (const legacy of (rawIndex as { entries: unknown[] }).entries) {
        if (!legacy || typeof legacy !== 'object') continue
        const record = legacy as { ts?: unknown; bytes?: unknown; retained?: unknown }
        if (typeof record.ts !== 'string' || typeof record.bytes !== 'number') continue
        if (!Number.isFinite(record.bytes)) continue
        pushHistory({
          ts: record.ts,
          bytes: record.bytes,
          location: 'history',
          retained: record.retained !== false
        })
      }
    }
    const nextHistory: AutoSaveHistoryEntry[] = [
      { ts, bytes, location: 'history', retained: true },
      ...history
    ]
    let total = nextHistory.reduce((sum, entry) => sum + entry.bytes, 0)
    let evicted = 0
    while (
      (nextHistory.length > policy.maxGenerations || total > policy.maxBytes) &&
      nextHistory.length > 0
    ) {
      const drop = nextHistory.pop()!
      total -= drop.bytes
      evicted += 1
      await removeFile(`${HISTORY_DIRECTORY}/${sanitizeTimestamp(drop.ts)}.json`)
    }
    if (total > policy.maxBytes) {
      throw deps.makeError(
        'history-overflow',
        'Unable to satisfy AutoSave history retention policy',
        false,
        undefined,
        { totalBytes: total }
      )
    }
    const historyTmp = `${HISTORY_DIRECTORY}/${historyKey}.json.tmp`
    await saveText(historyTmp, payload)
    await renameFile(historyTmp, `${HISTORY_DIRECTORY}/${historyKey}.json`)
    const normalizedHistory = nextHistory.map((entry) => ({ ...entry, retained: entry.retained !== false }))
    await saveJSON(tmp, {
      current: { ts, bytes, location: 'current' as const, retained: true },
      history: normalizedHistory,
      entries: normalizedHistory,
      generation: Math.max(0, Math.trunc(generation))
    })
    await renameFile(tmp, INDEX_PATH)
    return { history: normalizedHistory, totalBytes: total, evicted }
  }

  const readCurrent = async (): Promise<string | null> => loadText(CURRENT_PATH)

  const readHistory = async (ts: string): Promise<string | null> => {
    return loadText(`${HISTORY_DIRECTORY}/${sanitizeTimestamp(ts)}.json`)
  }

  return { loadIndex, writeCurrent, persistHistory, readCurrent, readHistory }
}
