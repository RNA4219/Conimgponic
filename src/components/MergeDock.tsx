import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { FlagSnapshot } from '../config/flags'
import { useSB } from '../store'
import { toMarkdown, toCSV, toJSONL, downloadText } from '../lib/exporters'
import { mergeCSV, mergeJSONL, readFileAsText, ImportMode } from '../lib/importers'
import type { Storyboard } from '../types'
import { isBaseTabId } from '../lib/merge/phasePlan'
import {
  getDefaultPreference,
  persistMergeDockActiveTab,
  resolveActiveTabTransition,
  resolvePreferenceSelection,
  sanitizeMergeDockActiveTab,
  sanitizePreference,
} from '../lib/merge/mergeDockPreference'
import { useMergeThreshold } from '../lib/merge/threshold'
import {
  DEFAULT_MERGE_ENGINE,
  attachAutoSaveLockEvents,
  type MergeEventHub,
  type MergeDecisionEvent,
  type MergeQueueCommand as MergeEngineQueueCommand,
  type MergeResult,
} from '../lib/merge'
import type { ProjectLockLease } from '../lib/locks'
import {
  computeStoryboardWarnings,
  diffBackupPolicy,
  mergeMarkdownStoryboard,
  readAutoSaveState,
  resolveMergeDockPhasePlan,
  shouldEnableDiffInteraction,
  shouldRenderDiffBackupCTA,
  startMergeDockAutoSaveHeartbeat,
  type MergeDockAutoSaveState,
  type MergeDockNotice,
  type MergeDockPhaseStats,
  type MergeDockPreference,
  type MergeDockTabId,
  type MergeDockWindow,
  type WorkspaceConfiguration,
} from './merge-dock/domain'
import { getDiffHunksFromEngine, type MergeHunk } from '../lib/merge'
import { useSB } from '../store'
import type { Storyboard } from '../types'
import {
  createMergeDockViewStore,
  useMergeDockViewStore,
  type MergeDockViewStore,
} from './merge-dock/store'

import type {
  MergeDockAutoSaveHeartbeatOptions,
  MergeDockAutoSaveHeartbeatState,
} from './merge-dock/model'
import {
  loadLatestCompiledSnapshot,
  MergeDockSnapshotError,
  saveStoryboardSnapshot,
} from './merge-dock/io'

export {
  diffBackupPolicy,
  planMergeDockTabs,
  resolveMergeDockPhasePlan,
  resolveMergeThresholdPlan,
  shouldShowDiffBackupCTA,
  isDiffBackupCTAEligible,
  shouldEnableDiffInteraction,
  shouldRenderDiffBackupCTA,
  mergeMarkdownStoryboard,
  startMergeDockAutoSaveHeartbeat,
} from './merge-dock/domain'
import { GoldenCompare } from './GoldenCompare'
import { DiffMergeView } from './DiffMergeView'
import type { 
  MergeHunk, 
  QueueMergeCommand,
  DiffMergeQueueCommandPayload,
  MergeDecisionEvent,
} from './diffMergeTypes.js'


export type MergeDockImportKind = 'jsonl' | 'csv' | 'markdown'

export const resolveMergeDockImportKind = (fileName: string): MergeDockImportKind | null => {
  const normalized = fileName.toLowerCase()
  if (normalized.endsWith('.jsonl')) {
    return 'jsonl'
  }
  if (normalized.endsWith('.csv')) {
    return 'csv'
  }
  if (normalized.endsWith('.md')) {
    return 'markdown'
  }
  return null
}


const tokenizeForSimilarity = (text: string): readonly string[] =>
  text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

const computeHunkSimilarity = (manual: string, ai: string): number => {
  const left = tokenizeForSimilarity(manual)
  const right = tokenizeForSimilarity(ai)
  if (left.length === 0 && right.length === 0) {
    return 1
  }
  if (left.length === 0 || right.length === 0) {
    return 0
  }
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  let intersection = 0
  leftSet.forEach((token) => {
    if (rightSet.has(token)) {
      intersection += 1
    }
  })
  const union = new Set([...leftSet, ...rightSet]).size
  return union === 0 ? 0 : intersection / union
}

const resolveStoryboardForDiff = (storyboard: Storyboard): Storyboard => {
  if (storyboard.scenes.length > 0) {
    return storyboard
  }
  const snapshot = Reflect.get(globalThis, '__conimgponic_sb_snapshot__') as Storyboard | undefined
  if (snapshot?.scenes?.length) {
    return snapshot
  }
  return storyboard
}

type DiffMergeQueueEvent =
  | {
      readonly type: 'queue:started'
      readonly precision: MergePrecision
      readonly origin: DiffMergeQueueCommandPayload['origin']
      readonly hunkIds: readonly string[]
      readonly hunks: readonly MergeHunk[]
      readonly autoSaveRequested: boolean
    }
  | {
      readonly type: 'queue:finished'
      readonly precision: MergePrecision
      readonly status: 'success' | 'error'
      readonly origin: DiffMergeQueueCommandPayload['origin']
      readonly hunkIds: readonly string[]
      readonly hunks: readonly MergeHunk[]
      readonly retryable: boolean
    }

interface DiffMergeQueueEvents {
  readonly publish: (event: DiffMergeQueueEvent) => void
  readonly subscribe: (listener: (event: DiffMergeQueueEvent) => void) => () => void
}

const DIFF_QUEUE_EVENTS_KEY = '__diffMergeEvents__'
const MERGE_QUEUE_HUB_KEY = '__mergeQueueHub__'

const createMergeEventHub = (): MergeEventHub => {
  const listeners = new Set<(event: MergeDecisionEvent) => void>()
  return {
    publish(event) {
      listeners.forEach((listener) => {
        try {
          listener(event)
        } catch (error) {
          console.error('MergeQueueHub listener failed', error)
        }
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

const createAutoSaveLease = (): ProjectLockLease => {
  const now = Date.now()
  return {
    leaseId: `merge-${crypto.randomUUID()}`,
    ownerId: 'merge-dock.diff',
    strategy: 'web-lock',
    viaFallback: false,
    resource: 'imgponic:project',
    acquiredAt: now,
    expiresAt: now + 25_000,
    ttlMillis: 25_000,
    heartbeatIntervalMs: 10_000,
    nextHeartbeatAt: now + 10_000,
    renewAttempt: 0,
  }
}

const createDiffMergeQueueEvents = (): DiffMergeQueueEvents => {
  const listeners = new Set<(event: DiffMergeQueueEvent) => void>()
  return {
    publish(event) {
      listeners.forEach((listener) => {
        try {
          listener(event)
        } catch (error) {
          console.error('DiffMergeQueueEvents listener failed', error)
        }
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

const buildDiffMergeHunks = (storyboard: Storyboard): readonly MergeHunk[] => {
  const source = resolveStoryboardForDiff(storyboard)
  return source.scenes.map((scene, index) => {
    const manual = scene.manual ?? ''
    const ai = scene.ai ?? ''
    const locked = scene.lock === 'manual' || scene.lock === 'ai'
    const prefer: MergeHunk['prefer'] = scene.lock === 'manual' ? 'manual' : scene.lock === 'ai' ? 'ai' : 'none'
    const trimmedManual = manual.trim()
    const trimmedAi = ai.trim()
    const similarity = computeHunkSimilarity(trimmedManual, trimmedAi)
    const decision: MergeHunk['decision'] = !locked && trimmedManual === trimmedAi ? 'auto' : 'conflict'
    const merged =
      decision === 'auto'
        ? prefer === 'ai'
          ? ai
          : manual
        : manual || ai
    const section = scene.shot ?? scene.slate ?? `Cut ${index + 1}`
    return {
      id: scene.id,
      section,
      decision,
      similarity,
      locked,
      merged,
      manual,
      ai,
      base: manual,
      prefer,
    }
  })
}


function Checks(): JSX.Element {
  const warnings = useSB((state) => computeStoryboardWarnings(state.sb))
  const snapshot = Reflect.get(globalThis, '__conimgponic_sb_snapshot__') as Storyboard | undefined
  const effectiveWarnings = snapshot ? computeStoryboardWarnings(snapshot) : warnings
  const hasWarnings = effectiveWarnings.length > 0

  return (
    <div
      style={{ padding: '6px 10px', color: hasWarnings ? '#b45309' : '#15803d' }}
      data-warning-count={effectiveWarnings.length}
    >
      {hasWarnings ? `Warnings: ${effectiveWarnings.length}` : 'OK: No issues found'}
      {hasWarnings ? (
        <ul>
          {effectiveWarnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

interface MergeDockProps {
  readonly flags: Pick<FlagSnapshot, 'merge'>
  readonly mergeThreshold?: number | null
  readonly autoAppliedRate?: number | null
  readonly phaseStats?: MergeDockPhaseStats | null
  readonly workspace?: WorkspaceConfiguration | null
  readonly autoSaveEnabled: boolean
}

export function MergeDock({
  flags,
  mergeThreshold = null,
  autoAppliedRate = null,
  phaseStats = null,
  workspace = null,
  autoSaveEnabled,
}: MergeDockProps){
  const sb = useSB((state) => state.sb)
  const storage = typeof window !== 'undefined' ? window.localStorage : undefined
  const mergeWindow = typeof window !== 'undefined' ? (window as MergeDockWindow) : undefined
  const [autoSave, setAutoSave] = useState<MergeDockAutoSaveState>(() => readAutoSaveState(mergeWindow))
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const stop = startMergeDockAutoSaveHeartbeat(mergeWindow, ({ autoSave: nextAutoSave, now: nextNow }) => {
      setNow(nextNow)
      setAutoSave((previous) => {
        if (
          previous.flushNow === nextAutoSave.flushNow &&
          previous.lastSuccessAt === nextAutoSave.lastSuccessAt
        ) {
          return previous
        }
        return nextAutoSave
      })
    })
    return () => {
      stop()
    }
  }, [mergeWindow])
  const { precision, threshold } = useMergeThreshold({
    flags,
    threshold: mergeThreshold,
    workspace,
  })
  let storedTabKey: string | null | undefined
  if (storage) {
    try {
      storedTabKey = storage.getItem('merge.lastTab')
    } catch (error) {
      console.warn(
        'MergeDock: failed to read stored active tab. Falling back without localStorage.',
        'merge.lastTab',
        error,
      )
    }
  }
  const lastTab = storedTabKey && (storedTabKey === 'diff' || isBaseTabId(storedTabKey)) ? (storedTabKey as MergeDockTabId) : undefined
  const phasePlan = useMemo(
    () =>
      resolveMergeDockPhasePlan({
        precision,
        threshold,
        lastTab,
        autoAppliedRate,
        phaseStats,
        autoSaveEnabled,
      }),
    [
      precision,
      threshold,
      lastTab,
      autoAppliedRate,
      phaseStats?.reviewBandCount ?? null,
      phaseStats?.conflictBandCount ?? null,
      autoSaveEnabled,
    ],
  )
  const plan = phasePlan.tabs
  const diffPlan = phasePlan.diff
  const defaultPreference = sanitizePreference(
    getDefaultPreference(precision, phasePlan.diff.enabled),
    precision,
    phasePlan.diff.enabled,
  )
  const storeRef = useRef<MergeDockViewStore>()
  if (!storeRef.current) {
    storeRef.current = createMergeDockViewStore(plan.initialTab, defaultPreference)
  }
  const store = storeRef.current
  const activeTab = useMergeDockViewStore(store, (state) => state.activeTab)
  const preference = useMergeDockViewStore(store, (state) => state.preference)
  const previousPrecisionRef = useRef(precision)
  const previousDiffEnabledRef = useRef(phasePlan.diff.enabled)
  useEffect(() => {
    const previousPrecision = previousPrecisionRef.current
    const previousDiffEnabled = previousDiffEnabledRef.current
    const nextTab = resolveActiveTabTransition({
      precision,
      previousPrecision,
      plan,
      activeTab,
      diffVisible: phasePlan.diff.visible,
      diffEnabled: phasePlan.diff.enabled,
      previousDiffEnabled,
    })
    const nextPreference = resolvePreferenceSelection({
      precision,
      previousPrecision,
      diffEnabled: phasePlan.diff.enabled,
      previousDiffEnabled,
      preference,
      defaultPreference,
    })
    previousPrecisionRef.current = precision
    previousDiffEnabledRef.current = phasePlan.diff.enabled
    if (nextTab !== activeTab || nextPreference !== preference) {
      store.setState({
        ...(nextTab !== activeTab ? { activeTab: nextTab } : {}),
        ...(nextPreference !== preference ? { preference: nextPreference } : {}),
      })
    }
  }, [
    activeTab,
    plan,
    phasePlan.diff.visible,
    phasePlan.diff.enabled,
    precision,
    preference,
    defaultPreference,
    store,
  ])
  useEffect(() => {
    if (!storage) return
    persistMergeDockActiveTab({
      storage,
      storageKey: 'merge.lastTab',
      tab: activeTab,
    })
  }, [activeTab, storage])

  const [compiledOverride, setCompiledOverride] = useState<string | null>(null)
  const [notice, setNotice] = useState<MergeDockNotice | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('manual')
  const notify = useCallback((level: MergeDockNotice['level'], message: string) => {
    setNotice({ level, message })
  }, [])

  const onTabChange = useCallback(
    (next: MergeDockTabId) => {
      const sanitized = sanitizeMergeDockActiveTab(
        next,
        plan,
        phasePlan.diff.visible,
        phasePlan.diff.enabled,
      )
      store.getState().setActiveTab(sanitized)
    },
    [phasePlan.diff.visible, plan, store],
  )

  const onPreferenceChange = useCallback(
    (next: MergeDockPreference) => {
      const sanitized = sanitizePreference(next, precision, phasePlan.diff.enabled)
      store.getState().setPreference(sanitized)
    },
    [phasePlan.diff.enabled, precision, store],
  )

  useEffect(() => {
    setCompiledOverride(null)
  }, [preference])

  const compiled = useMemo(() => {
    const lines: string[] = []
    for (let i = 0; i < sb.scenes.length; i++) {
      const s = sb.scenes[i]
      const pick = s.lock
        ? s.lock === 'manual'
          ? s.manual
          : s.ai
        : preference === 'manual-first'
          ? s.manual || s.ai
          : preference === 'ai-first'
            ? s.ai || s.manual
            : s.manual || s.ai
      lines.push(`## Cut ${i + 1}\n${pick}`)
    }
    return lines.join('\n\n')
  }, [sb, preference])
  const compiledDisplay = compiledOverride ?? compiled

  const diffHunks: readonly MergeHunk[] = phasePlan.diff.enabled ? buildDiffMergeHunks(sb) : []
  const diffQueueEvents = useMemo(() => createDiffMergeQueueEvents(), [])
  const diffHunkMap = useMemo(() => {
    const map = new Map<string, MergeHunk>()
    diffHunks.forEach((hunk) => {
      map.set(hunk.id, hunk)
    })
    return map
  }, [diffHunks])


  const diffQueueMergeCommand = useMemo<QueueMergeCommand>(() => {
    const mergeHub = createMergeEventHub()
    const queuedCommands: MergeEngineQueueCommand[] = []
    const queue: QueueMergeCommand = async (payload) => {
      const uniqueIds = Array.from(new Set(payload.hunkIds))
      const collectorSurface = payload.telemetryContext.collectorSurface
      const analyzerSurface = payload.telemetryContext.analyzerSurface
      const responseCollectorSurface = 'diff-merge.hunk-list' as const

      if (!phasePlan.diff.enabled) {
        const disabledHunks = uniqueIds
          .map((id) => diffHunkMap.get(id))
          .filter((hunk): hunk is MergeHunk => Boolean(hunk))
        diffQueueEvents.publish({
          type: 'queue:finished',
          precision: payload.precision,
          status: 'error',
          origin: payload.origin,
          hunkIds: uniqueIds,
          hunks: disabledHunks,
          retryable: true,
        })
        return {
          status: 'error',
          hunkIds: uniqueIds,
          telemetry: { collectorSurface: responseCollectorSurface, analyzerSurface, retryable: true },
        }
      }

      const knownEntries = uniqueIds
        .map((id) => {
          const hunk = diffHunkMap.get(id)
          return hunk ? { id, hunk } : null
        })
        .filter((entry): entry is { id: string; hunk: MergeHunk } => entry !== null)

      const knownIds = knownEntries.map((entry) => entry.id)
      const knownHunks = knownEntries.map((entry) => entry.hunk)

      diffQueueEvents.publish({
        type: 'queue:started',
        precision: payload.precision,
        origin: payload.origin,
        hunkIds: knownIds,
        hunks: knownHunks,
        autoSaveRequested: payload.metadata.autoSaveRequested,
      })

      const mergeCollector = (mergeWindow as
        | { Day8Collector?: { publish?: (event: Record<string, unknown>) => void } }
        | undefined
      )?.Day8Collector
      mergeCollector?.publish?.({
        feature: 'merge.diff',
        event: 'queue:start',
        precision: payload.precision,
        origin: payload.origin,
        hunk_ids: knownIds,
        phase_guard: phasePlan.phase,
        diff_exposure: phasePlan.diff.exposure,
        auto_save_requested: payload.metadata.autoSaveRequested,
      })

      if (knownIds.length === 0) {
        diffQueueEvents.publish({
          type: 'queue:finished',
          precision: payload.precision,
          status: 'success',
          origin: payload.origin,
          hunkIds: knownIds,
          hunks: knownHunks,
          retryable: false,
        })
        mergeCollector?.publish?.({
          feature: 'merge.diff',
          event: 'queue:finish',
          precision: payload.precision,
          origin: payload.origin,
          hunk_ids: knownIds,
          status: 'success',
          retryable: false,
          phase_guard: phasePlan.phase,
          diff_exposure: phasePlan.diff.exposure,
          auto_save_requested: payload.metadata.autoSaveRequested,
        })
        return {
          status: 'success',
          hunkIds: [],
          telemetry: { collectorSurface: responseCollectorSurface, analyzerSurface, retryable: false },
        }
      }

      queuedCommands.length = 0
      const detachAutoSave = attachAutoSaveLockEvents(mergeHub)
      const lease = createAutoSaveLease()
      let released = false
      const publishRelease = () => {
        if (released) return
        released = true
        mergeHub.publish({ type: 'merge:autosave:lock', stage: 'released', lease })
      }
      mergeHub.publish({ type: 'merge:autosave:lock', stage: 'acquired', lease })

      let responseStatus: 'success' | 'error' = 'success'
      let retryable = false
      let finishedHunks: readonly MergeHunk[] = []

      try {
        const mergeResults = knownEntries.map(({ id, hunk }) => {
          const sceneEvents: MergeEventHub = {
            publish(event) {
              if (event.type === 'merge:auto-applied' || event.type === 'merge:conflict-detected') {
                mergeHub.publish({ ...event, hunk: { ...event.hunk, id } })
                return
              }
              mergeHub.publish(event)
            },
            subscribe(listener) {
              return mergeHub.subscribe(listener)
            },
          }
          const result = DEFAULT_MERGE_ENGINE.merge3(
            { base: hunk.base, ours: hunk.manual, theirs: hunk.ai, sceneId: id },
            {
              profile: { precision: payload.precision, threshold: phasePlan.threshold.request },
              events: sceneEvents,
              queueMergeCommand: (command) => {
                queuedCommands.push(command)
              },
            },
          )
          return { sceneId: id, original: hunk, result }
        })
        finishedHunks = mergeResults.flatMap((entry) =>
          entry.result.hunks.map((hunk) => ({ ...hunk, id: entry.sceneId })),
        )
        const totalConflicts = mergeResults.reduce(
          (count, entry) => count + entry.result.stats.conflictDecisions,
          0,
        )
        retryable = totalConflicts > 0

        if (mergeResults.some((entry) => entry.result.hunks.some((hunk) => hunk.decision === 'auto'))) {
          useSB.setState((state) => {
            let changed = false
            const nextScenes = state.sb.scenes.map((scene) => {
              const match = mergeResults.find((entry) => entry.sceneId === scene.id)
              if (!match) {
                return scene
              }
              const hasAutoDecision = match.result.hunks.some((hunk) => hunk.decision === 'auto')
              if (!hasAutoDecision) {
                return scene
              }
              const mergedText = match.result.mergedText
              const manualChanged = mergedText !== scene.manual
              const statusChanged = scene.status !== 'dirty'
              if (!manualChanged && !statusChanged) {
                return scene
              }
              changed = true
              return {
                ...scene,
                ...(manualChanged ? { manual: mergedText } : {}),
                ...(statusChanged ? { status: 'dirty' as const } : {}),
              }
            })
            if (!changed) {
              return state
            }
            return { sb: { ...state.sb, scenes: nextScenes } }
          })
        }
      } catch (error) {
        console.error('MergeDock: diff queue merge failed', error)
        responseStatus = 'error'
        retryable = true
      } finally {
        publishRelease()
        detachAutoSave?.()
      }

      if (responseStatus !== 'error' && payload.metadata.autoSaveRequested && typeof autoSave.flushNow === 'function') {
        try {
          await Promise.resolve(autoSave.flushNow())
        } catch (error) {
          console.warn('MergeDock: AutoSave flush failed after merge queue', error)
          responseStatus = 'error'
          retryable = true
        }
      }

      const finishedEventStatus = responseStatus === 'error' ? 'error' : 'success'

      diffQueueEvents.publish({
        type: 'queue:finished',
        precision: payload.precision,
        status: finishedEventStatus,
        origin: payload.origin,
        hunkIds: knownIds,
        hunks: finishedHunks,
        retryable,
      })

      mergeCollector?.publish?.({
        feature: 'merge.diff',
        event: 'queue:finish',
        precision: payload.precision,
        origin: payload.origin,
        hunk_ids: knownIds,
        status: responseStatus,
        retryable,
        phase_guard: phasePlan.phase,
        diff_exposure: phasePlan.diff.exposure,
        auto_save_requested: payload.metadata.autoSaveRequested,
      })

      return {
        status: responseStatus,
        hunkIds: knownIds,
        telemetry: { collectorSurface: responseCollectorSurface, analyzerSurface, retryable },
      }
    }

    Reflect.set(queue, DIFF_QUEUE_EVENTS_KEY, diffQueueEvents)
    Reflect.set(queue, MERGE_QUEUE_HUB_KEY, mergeHub)
    Reflect.set(queue, '__mergeQueuedCommands__', queuedCommands)
    return queue
  }, [
    autoSave.flushNow,
    diffHunkMap,
    diffQueueEvents,
    mergeWindow,
    phasePlan.diff.enabled,
    phasePlan.diff.exposure,
    phasePlan.phase,
    phasePlan.threshold.request,
  ])

  const diffInteractionEnabled = shouldEnableDiffInteraction({
    diffPlan,
    guard: phasePlan.guard,
  })
  const showBackupCTA = shouldRenderDiffBackupCTA({
    diffPlan,
    tabPlan: plan,
    policy: diffBackupPolicy,
    precision,
    activeTab,
    autoSave,
    now,
  })

  const onImport = useCallback(
    async (file: File, mode: ImportMode) => {
      try {
        const text = await readFileAsText(file)
        const current = useSB.getState().sb
        const kind = resolveMergeDockImportKind(file.name)
        let next: Storyboard | null = null
        if (kind === 'jsonl') {
          next = mergeJSONL(current, text, mode)
        } else if (kind === 'csv') {
          next = mergeCSV(current, text, mode)
        } else if (kind === 'markdown') {
          next = mergeMarkdownStoryboard(current, text, mode)
        } else {
          notify('error', 'Unsupported file type. Use .jsonl / .csv / .md')
          return
        }
        if (!next) {
          return
        }
        useSB.setState({ sb: next })
        notify('info', 'Imported storyboard updates.')
      } catch (error) {
        console.error(error)
        notify('error', 'Import failed. See console for details.')
      }
    },
    [notify],
  )

  return (
    <div
      data-merge-phase={phasePlan.phase}
      data-merge-autosave-enabled={autoSaveEnabled ? 'true' : 'false'}
      data-merge-diff-visible={diffPlan.visible ? 'true' : 'false'}
      data-merge-diff-enabled={diffPlan.enabled ? 'true' : 'false'}
      data-merge-diff-exposure={diffPlan.exposure}
      data-merge-diff-initial-tab={diffPlan.initialTab}
    >
      <div className="tabs">
        {plan.tabs.map((entry) => (
          <button
            key={entry.id}
            className={"tab " + (activeTab === entry.id ? 'active' : '')}
            type="button"
            onClick={() => onTabChange(entry.id)}
          >
            {entry.label}
            {entry.badge ? <span style={{ marginLeft: 4, fontSize: '0.75em', color: '#2563eb' }}>{entry.badge}</span> : null}
          </button>
        ))}
        <div style={{ marginLeft: 'auto' }}><Checks/></div>
      </div>

      {notice ? (
        <div
          role="status"
          data-testid="merge-dock-notice"
          data-level={notice.level}
          style={{ margin: '8px', padding: '8px', borderRadius: 4, background: notice.level === 'error' ? '#fee2e2' : '#e0f2fe', color: '#111827' }}
        >
          {notice.message}
        </div>
      ) : null}

      {diffPlan.visible && activeTab === 'diff' && (
        <div
          style={{ padding: 8, display: 'grid', gap: 8 }}
          data-merge-diff-visible={diffPlan.visible ? 'true' : 'false'}
          data-merge-diff-enabled={diffPlan.enabled ? 'true' : 'false'}
          data-merge-diff-exposure={diffPlan.exposure}
          data-merge-diff-initial-tab={diffPlan.initialTab}
          aria-disabled={diffInteractionEnabled ? undefined : 'true'}
        >
          {showBackupCTA ? (
            <button
              type="button"
              className="btn"
              data-testid="merge-dock-backup-cta"
              onClick={() => {
                if (autoSave.flushNow) {
                  autoSave.flushNow()
                  notify('info', 'バックアップを実行しました。')
                } else {
                  notify('error', 'バックアップ操作を利用できません。')
                }
              }}
            >
              バックアップを今すぐ実行
            </button>
          ) : null}
          {diffInteractionEnabled ? (
            <DiffMergeViewWithRealHunks
              precision={precision}
              hunks={emptyDiffHunks}
              queueMergeCommand={diffQueueMergeCommand}
              threshold={threshold}
              phaseStats={phaseStats}
              autoSaveEnabled={autoSaveEnabled}
              autoApplied={phasePlan.autoApplied}
              disabled={!phasePlan.diff.enabled}
            />
          ) : (
            <div
              data-component="diff-merge-view"
              role="note"
              data-testid="merge-diff-disabled-placeholder"
              style={{
                padding: '16px',
                borderRadius: 4,
                border: '1px dashed #cbd5f5',
                background: '#f8fafc',
                color: '#1f2937',
              }}
            >
              Diff マージは現在準備中です。レビュー指標が揃うまでお待ちください。
            </div>
          )}
        </div>
      )}

      {activeTab === 'compiled' && (
        <div>
          <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center' }}>
            <label>統合ルール:</label>
            <select value={preference} onChange={(e) => onPreferenceChange(e.target.value as MergeDockPreference)}>
              <option value="manual-first">Manual優先</option>
              <option value="ai-first">AI優先</option>
              <option
                value="diff-merge"
                disabled={precision === 'stable' && !phasePlan.diff.enabled}
              >
                差分マージ（暫定）
              </option>
            </select>
          </div>
          <pre>{compiledDisplay}</pre>
        </div>
      )}

      {activeTab === 'shot' && (
        <div style={{ padding: 8, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" type="button" onClick={() => downloadText('shotlist.md', toMarkdown(sb))}>
              Export MD
            </button>
            <button className="btn" type="button" onClick={() => downloadText('shotlist.csv', toCSV(sb))}>
              Export CSV
            </button>
            <button className="btn" type="button" onClick={() => downloadText('shotlist.jsonl', toJSONL(sb))}>
              Export JSONL
            </button>
            <button
              className="btn"
              type="button"
              onClick={async () => {
                try {
                  const { directory } = await saveStoryboardSnapshot(sb)
                  notify('info', `Saved snapshot to OPFS: ${directory}`)
                } catch (error) {
                  console.error(error)
                  notify('error', 'Failed to save snapshot to OPFS.')
                }
              }}
            >
              Save Snapshot (OPFS)
            </button>
            <button
              className="btn"
              type="button"
              onClick={async () => {
                try {
                  const snapshot = await loadLatestCompiledSnapshot()
                  if (!snapshot) {
                    notify('error', 'No snapshot available.')
                    return
                  }
                  setCompiledOverride(snapshot.compiled)
                  notify('info', `Restored compiled snapshot from ${snapshot.timestamp}.`)
                } catch (error) {
                  console.error(error)
                  const message =
                    error instanceof MergeDockSnapshotError
                      ? error.message
                      : 'Failed to restore compiled snapshot.'
                  notify('error', message)
                }
              }}
            >
              Restore Last Compiled
            </button>
          </div>
          <pre>{toCSV(sb)}</pre>
        </div>
      )}

      {activeTab === 'assets' && (
        <div style={{ padding: 8 }}>
          <p style={{ margin: '4px 0' }}>登場人物/小道具/背景のカタログ（OPFS保存対応）。</p>
        </div>
      )}

      {activeTab === 'golden' && <GoldenCompare />}

      {activeTab === 'import' && (
        <div style={{ padding: 8, display: 'grid', gap: 8 }}>
          <div>
            <label>Import JSONL/CSV/MD → 反映先: </label>
            <select value={importMode} onChange={(event) => setImportMode(event.target.value as ImportMode)}>
              <option value="manual">manual</option>
              <option value="ai">ai</option>
            </select>
          </div>
          <input
            type="file"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              await onImport(file, importMode)
              event.target.value = ''
            }}
          />
        </div>
      )}
    </div>
  )
}

interface DiffMergeViewWithRealHunksProps {
  readonly precision: 'beta' | 'stable';
  readonly threshold: number;
  readonly phaseStats: MergeDockPhaseStats | null;
  readonly autoSaveEnabled: boolean;
  readonly autoApplied?: { readonly rate: number; readonly target: number; readonly meetsTarget: boolean | null };
  readonly disabled?: boolean;
  readonly queueMergeCommand: (command: any) => Promise<{ status: 'success' | 'partial' | 'error'; hunkIds: string[]; telemetry: any }>;
}

const DiffMergeViewWithRealHunks: React.FC<DiffMergeViewWithRealHunksProps> = ({
  precision,
  threshold,
  phaseStats,
  autoSaveEnabled,
  autoApplied,
  disabled = false,
  queueMergeCommand,
}) => {
  const sb = useSB((state) => state.sb);
  const [hunks, setHunks] = useState<readonly MergeHunk[]>([]);
  
  // Generate merge input from storyboard scenes
  useEffect(() => {
    if ((precision === 'beta' || precision === 'stable') && autoSaveEnabled) {
      // Create a simple merge input from the storyboard
      // In a real implementation, this would come from actual diff sources
      const input = {
        base: sb.scenes.map(s => s.manual || s.ai || '').join('\n\n'),
        ours: sb.scenes.map(s => s.manual || '').join('\n\n'),
        theirs: sb.scenes.map(s => s.ai || '').join('\n\n'),
        sceneId: sb.id || 'default-storyboard'
      };

      // Get the hunks and stats from the merge engine
      const result = getDiffHunksFromEngine(
        { precision, threshold, phaseStats, autoSaveEnabled },
        input
      );
      
      setHunks(result.hunks);
    } else {
      setHunks([]);
    }
  }, [sb, precision, threshold, phaseStats, autoSaveEnabled]);

  return (
    <DiffMergeView
      precision={precision}
      hunks={hunks}
      queueMergeCommand={queueMergeCommand}
      autoApplied={autoApplied}
      disabled={disabled}
    />
  );
};
