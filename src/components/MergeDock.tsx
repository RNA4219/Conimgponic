import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

import { resolveFlags, type FlagSnapshot } from '../config'
import { useSB } from '../store'
import { toMarkdown, toCSV, toJSONL, downloadText } from '../lib/exporters'
import { mergeCSV, mergeJSONL, readFileAsText, ImportMode } from '../lib/importers'
import type { Storyboard } from '../types'
import { saveText, loadText, ensureDir } from '../lib/opfs'
import { sha256Hex } from '../lib/hash'
import { GoldenCompare } from './GoldenCompare'
import {
  DiffMergeView,
  type MergeHunk,
  type QueueMergeCommand,
} from './DiffMergeView'

type MergePrecision = FlagSnapshot['merge']['precision']

const BASE_TAB_IDS = ['compiled', 'shot', 'assets', 'import', 'golden'] as const
type BaseTabId = (typeof BASE_TAB_IDS)[number]
type MergeDockTabId = BaseTabId | 'diff'

type MergeDockTabPlanEntry = { readonly id: MergeDockTabId; readonly label: string; readonly badge?: 'Beta' }
type MergeDockDiffPlan = {
  readonly exposure: 'opt-in' | 'default'
  readonly backupAfterMs?: number
}

type MergeDockTabPlan = {
  readonly tabs: readonly MergeDockTabPlanEntry[]
  readonly initialTab: MergeDockTabId
  readonly diff?: MergeDockDiffPlan
}

type MergeDockPreference = 'manual-first' | 'ai-first' | 'diff-merge'

interface MergeDockViewState {
  readonly activeTab: MergeDockTabId
  readonly preference: MergeDockPreference
  readonly setActiveTab: (tab: MergeDockTabId) => void
  readonly setPreference: (preference: MergeDockPreference) => void
}

type MergeDockViewStore = StoreApi<MergeDockViewState>

const createMergeDockViewStore = (
  initialTab: MergeDockTabId,
  preference: MergeDockPreference,
): MergeDockViewStore =>
  createStore<MergeDockViewState>((set) => ({
    activeTab: initialTab,
    preference,
    setActiveTab: (tab) => set({ activeTab: tab }),
    setPreference: (next) => set({ preference: next }),
  }))

type MergePhaseKey = 'phase-a' | 'phase-b'

export interface MergeThresholdPlan {
  readonly precision: MergePrecision
  readonly input: number | null
  readonly request: number
  readonly slider: { readonly min: number; readonly max: number; readonly step: number; readonly defaultValue: number }
  readonly autoTarget: number
  readonly reviewBand?: { readonly min: number; readonly max: number }
  readonly conflictBand?: { readonly max: number }
}

export interface MergeDockPhasePlan {
  readonly precision: MergePrecision
  readonly phase: MergePhaseKey
  readonly tabs: MergeDockTabPlan
  readonly diff: { readonly exposure: 'hidden' | 'opt-in' | 'default'; readonly enabled: boolean; readonly initialTab: MergeDockTabId }
  readonly threshold: MergeThresholdPlan
  readonly autoApplied: { readonly rate: number | null; readonly target: number; readonly meetsTarget: boolean | null }
  readonly guard: { readonly phaseBRequired: boolean; readonly reviewBandCount: number | null; readonly conflictBandCount: number | null }
}

export interface MergeDockPhaseStats {
  readonly reviewBandCount: number
  readonly conflictBandCount: number
}

export interface MergeDockPhaseInput {
  readonly precision: MergePrecision
  readonly threshold?: number | null
  readonly lastTab?: MergeDockTabId
  readonly autoAppliedRate?: number | null
  readonly phaseStats?: MergeDockPhaseStats | null
}

interface MergeThresholdRule {
  readonly phase: MergePhaseKey
  readonly diffExposure: 'hidden' | 'opt-in' | 'default'
  readonly clamp: { readonly min: number; readonly max: number | null }
  readonly autoOffset: number
  readonly reviewBand?: { readonly below: number; readonly above: number }
  readonly conflictBand?: { readonly below: number }
  readonly slider: { readonly min: number; readonly max: number }
}

const DIFF_BACKUP_THRESHOLD_MS = 5 * 60 * 1000

const DEFAULT_THRESHOLD = 0.72

const THRESHOLD_RULES: Record<MergePrecision, MergeThresholdRule> = Object.freeze({
  legacy: {
    phase: 'phase-a',
    diffExposure: 'hidden',
    clamp: { min: 0.65, max: null },
    autoOffset: 0.08,
    slider: { min: 0.65, max: 0.9 },
  },
  beta: {
    phase: 'phase-b',
    diffExposure: 'opt-in',
    clamp: { min: 0.68, max: 0.9 },
    autoOffset: 0.05,
    reviewBand: { below: 0.02, above: 0.05 },
    conflictBand: { below: 0.02 },
    slider: { min: 0.68, max: 0.9 },
  },
  stable: {
    phase: 'phase-b',
    diffExposure: 'default',
    clamp: { min: 0.7, max: 0.94 },
    autoOffset: 0.03,
    reviewBand: { below: 0.01, above: 0.03 },
    conflictBand: { below: 0.01 },
    slider: { min: 0.7, max: 0.94 },
  },
})

const BASE_TABS = Object.freeze([
  { id: 'compiled', label: 'Compiled Script' },
  { id: 'shot', label: 'Shotlist / Export' },
  { id: 'assets', label: 'Assets' },
  { id: 'import', label: 'Import' },
  { id: 'golden', label: 'Golden' },
] as const satisfies readonly MergeDockTabPlanEntry[])

const MERGE_DOCK_TAB_PLAN: Record<MergePrecision, MergeDockTabPlan> = Object.freeze({
  legacy: { tabs: BASE_TABS, initialTab: 'compiled' },
  beta: {
    tabs: [...BASE_TABS, { id: 'diff', label: 'Diff (Beta)', badge: 'Beta' }],
    initialTab: 'compiled',
    diff: { exposure: 'opt-in' },
  },
  stable: {
    tabs: [
      ...BASE_TABS.slice(0, -1),
      { id: 'diff', label: 'Diff' },
      BASE_TABS[BASE_TABS.length - 1]!,
    ],
    initialTab: 'diff',
    diff: { exposure: 'default', backupAfterMs: DIFF_BACKUP_THRESHOLD_MS },
  },
})

const isBaseTabId = (value: unknown): value is BaseTabId => typeof value === 'string' && (BASE_TAB_IDS as readonly string[]).includes(value)

const MERGE_THRESHOLD_STORAGE_KEY = 'conimg.merge.threshold'

const parseMergePrecision = (value: unknown): MergePrecision | undefined => {
  if (value === 'legacy' || value === 'beta' || value === 'stable') {
    return value
  }
  return undefined
}

const getDefaultPreference = (precision: MergePrecision, diffEnabled: boolean): MergeDockPreference =>
  precision === 'stable' && diffEnabled ? 'diff-merge' : 'manual-first'

const sanitizePreference = (
  preference: MergeDockPreference,
  precision: MergePrecision,
  diffEnabled: boolean,
): MergeDockPreference => {
  if (precision === 'stable' && diffEnabled) return preference
  return preference === 'diff-merge' ? 'manual-first' : preference
}

const sanitizeActiveTab = (
  tab: MergeDockTabId,
  plan: MergeDockTabPlan,
  diffEnabled: boolean,
): MergeDockTabId => {
  if (!plan.tabs.some((entry) => entry.id === tab)) return plan.initialTab
  if (tab === 'diff' && !diffEnabled) return plan.initialTab
  return tab
}

interface MergeDockAutoSaveState {
  readonly flushNow?: () => void
  readonly lastSuccessAt?: string
}

type MergeDockWindow = Window & {
  __mergeDockAutoSaveSnapshot?: { lastSuccessAt?: string }
  __mergeDockFlushNow?: () => void
}

const readAutoSaveState = (target: MergeDockWindow | undefined): MergeDockAutoSaveState => ({
  flushNow: typeof target?.__mergeDockFlushNow === 'function' ? target.__mergeDockFlushNow : undefined,
  lastSuccessAt: target?.__mergeDockAutoSaveSnapshot?.lastSuccessAt,
})

const emptyDiffHunks: readonly MergeHunk[] = []

const diffMergeNoopCommand: QueueMergeCommand = async () => ({
  status: 'success',
  hunkIds: [],
  telemetry: { collectorSurface: 'diff-merge.hunk-list', analyzerSurface: 'diff-merge.queue', retryable: false },
})

type MergeDockNotice = { readonly level: 'info' | 'error'; readonly message: string }

const parseMergeThreshold = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

interface MergeThresholdOptions {
  readonly precision?: MergePrecision | null
  readonly threshold?: number | null
}

interface MergeThresholdSnapshot {
  readonly precision: MergePrecision
  readonly threshold: number | undefined
}

type WorkspaceConfiguration =
  | { readonly get: <T = unknown>(key: string) => T | undefined }
  | Record<string, unknown>

type MergeThresholdStorage = Pick<Storage, 'getItem'> | null

interface MergeThresholdSourceOptions extends MergeThresholdOptions {
  readonly workspace?: WorkspaceConfiguration | null
  readonly storage?: MergeThresholdStorage
  readonly flags?: Pick<FlagSnapshot, 'merge'> | null
}

const readWorkspaceSetting = (
  workspace: WorkspaceConfiguration | null | undefined,
  key: string,
): unknown => {
  if (!workspace) {
    return undefined
  }

  const accessor = workspace as { readonly get?: <T = unknown>(target: string) => T | undefined }
  if (typeof accessor.get === 'function') {
    return accessor.get(key)
  }

  if (typeof workspace === 'object' && workspace) {
    if (Object.prototype.hasOwnProperty.call(workspace, key)) {
      return (workspace as Record<string, unknown>)[key]
    }

    return key.split('.').reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object') {
        return undefined
      }
      if (!(segment in (current as Record<string, unknown>))) {
        return undefined
      }
      return (current as Record<string, unknown>)[segment]
    }, workspace as Record<string, unknown>)
  }

  return undefined
}

export const resolveMergeThresholdSnapshot = (
  options: MergeThresholdSourceOptions = {},
): MergeThresholdSnapshot => {
  const workspace = options.workspace ?? null
  const storage = options.storage ?? null
  const snapshot: Pick<FlagSnapshot, 'merge'> =
    options.flags ?? resolveFlags({ workspace, storage })
  const envPrecision = parseMergePrecision(
    (() => {
      const meta = (import.meta as ImportMeta & { env?: Record<string, unknown> })
      const candidate = meta.env?.VITE_MERGE_PRECISION
      return typeof candidate === 'string' ? candidate : undefined
    })(),
  )
  const precision =
    options.precision ??
    envPrecision ??
    snapshot.merge.precision
  const envOverrides =
    envPrecision !== undefined && options.precision === undefined && options.threshold === undefined

  const overrideThreshold = parseMergeThreshold(options.threshold)
  if (overrideThreshold !== undefined) {
    return { precision, threshold: overrideThreshold }
  }

  if (envOverrides) {
    return { precision, threshold: DEFAULT_THRESHOLD }
  }

  const flagThreshold = parseMergeThreshold(snapshot.merge.threshold)
  if (flagThreshold !== undefined) {
    return { precision, threshold: flagThreshold }
  }

  const workspaceThreshold = parseMergeThreshold(
    readWorkspaceSetting(workspace, MERGE_THRESHOLD_STORAGE_KEY),
  )
  if (workspaceThreshold !== undefined) {
    return { precision, threshold: workspaceThreshold }
  }

  const storedThreshold = parseMergeThreshold(storage?.getItem(MERGE_THRESHOLD_STORAGE_KEY))
  if (storedThreshold !== undefined) {
    return { precision, threshold: storedThreshold }
  }

  return { precision, threshold: DEFAULT_THRESHOLD }
}

type MergeThresholdHookOptions = MergeThresholdSourceOptions

const useMergeThreshold = (
  options: MergeThresholdHookOptions = {},
): MergeThresholdSnapshot => {
  const fallbackStorage: MergeThresholdStorage =
    typeof window !== 'undefined' ? window.localStorage : null
  const storage = options.storage ?? fallbackStorage
  const workspace = options.workspace ?? null
  const providedFlags = options.flags ?? null
  const snapshot = useMemo<Pick<FlagSnapshot, 'merge'>>(
    () => providedFlags ?? resolveFlags({ workspace, storage }),
    [providedFlags, workspace, storage],
  )

  return useMemo(
    () =>
      resolveMergeThresholdSnapshot({
        ...options,
        precision: options.precision ?? snapshot.merge.precision,
        workspace,
        storage,
        flags: snapshot,
      }),
    [
      options.precision,
      options.threshold,
      workspace,
      storage,
      snapshot.merge.precision,
      snapshot.merge.threshold,
    ],
  )
}

export const planMergeDockTabs = (precision: MergePrecision, lastTab?: MergeDockTabId): MergeDockTabPlan => {
  const plan = MERGE_DOCK_TAB_PLAN[precision]
  const requested = lastTab && (lastTab === 'diff' || isBaseTabId(lastTab)) ? lastTab : undefined
  const sanitized = requested && plan.tabs.some((entry) => entry.id === requested) ? requested : undefined
  const diffConfig = plan.diff ? { diff: plan.diff } : {}
  if (precision === 'stable') {
    return { tabs: plan.tabs, initialTab: plan.initialTab, ...diffConfig }
  }
  if (precision === 'legacy') {
    const initial = sanitized && sanitized !== 'diff' ? sanitized : plan.initialTab
    return { tabs: plan.tabs, initialTab: initial }
  }
  return { tabs: plan.tabs, initialTab: sanitized ?? plan.initialTab, ...diffConfig }
}


const clampValue = (value: number, min: number, max: number | null): number => {
  const upper = typeof max === 'number' ? max : 1
  return Math.min(Math.max(value, min), upper)
}

const roundRate = (value: number): number => Math.min(1, Math.max(0, Math.round(value * 100) / 100))

export const resolveMergeThresholdPlan = (precision: MergePrecision, threshold: number | null | undefined): MergeThresholdPlan => {
  const rule = THRESHOLD_RULES[precision]
  const validInput = typeof threshold === 'number' && Number.isFinite(threshold) ? threshold : null
  const base = validInput ?? DEFAULT_THRESHOLD
  const clamped = clampValue(base, rule.clamp.min, rule.clamp.max)
  const request = roundRate(clamped)
  const autoTarget = roundRate(clamped + rule.autoOffset)
  const reviewBand = rule.reviewBand
    ? {
        min: roundRate(clamped - rule.reviewBand.below),
        max: roundRate(clamped + rule.reviewBand.above),
      }
    : undefined
  const conflictBand = rule.conflictBand
    ? { max: roundRate(clamped - rule.conflictBand.below) }
    : undefined

  return {
    precision,
    input: validInput,
    request,
    slider: { min: rule.slider.min, max: rule.slider.max, step: 0.01, defaultValue: request },
    autoTarget,
    reviewBand,
    conflictBand,
  }
}

export const resolveMergeDockPhasePlan = ({
  precision,
  threshold,
  lastTab,
  autoAppliedRate,
  phaseStats,
}: MergeDockPhaseInput): MergeDockPhasePlan => {
  const rule = THRESHOLD_RULES[precision]
  const thresholdPlan = resolveMergeThresholdPlan(precision, threshold)
  const rawPlan = planMergeDockTabs(precision, lastTab)
  const statsProvided = !!phaseStats
  const reviewBandCount = statsProvided ? Math.max(0, phaseStats.reviewBandCount) : null
  const conflictBandCount = statsProvided ? Math.max(0, phaseStats.conflictBandCount) : null
  const hasReviewSignals = (reviewBandCount ?? 0) > 0
  const hasConflictSignals = (conflictBandCount ?? 0) > 0
  const phaseBRequired =
    precision === 'legacy'
      ? false
      : statsProvided
        ? precision === 'beta'
          ? hasReviewSignals
          : hasReviewSignals || hasConflictSignals
        : false
  const diffEnabled = !!rawPlan.diff && phaseBRequired
  const effectiveTabs = diffEnabled ? rawPlan.tabs : rawPlan.tabs.filter((entry) => entry.id !== 'diff')
  const effectiveInitial = diffEnabled || rawPlan.initialTab !== 'diff' ? rawPlan.initialTab : effectiveTabs[0]?.id ?? rawPlan.initialTab
  const sanitizedInitial =
    effectiveInitial && effectiveTabs.some((entry) => entry.id === effectiveInitial)
      ? effectiveInitial
      : effectiveTabs[0]?.id ?? rawPlan.initialTab
  const diffExposure = diffEnabled
    ? rawPlan.diff?.exposure ?? 'hidden'
    : rawPlan.diff
      ? rawPlan.diff.exposure === 'default'
        ? 'opt-in'
        : rawPlan.diff.exposure ?? 'hidden'
      : 'hidden'
  const diffTabsPlan = rawPlan.diff
    ? {
        exposure: diffEnabled ? rawPlan.diff.exposure : 'opt-in',
        ...(diffEnabled && rawPlan.diff.backupAfterMs
          ? { backupAfterMs: rawPlan.diff.backupAfterMs }
          : {}),
      }
    : undefined
  const normalizedRate = typeof autoAppliedRate === 'number' && Number.isFinite(autoAppliedRate) ? autoAppliedRate : null
  const meetsTarget = normalizedRate == null ? null : normalizedRate >= thresholdPlan.autoTarget

  return {
    precision,
    phase: rule.phase,
    tabs: { tabs: effectiveTabs, initialTab: sanitizedInitial, diff: diffTabsPlan },
    diff: { exposure: diffExposure, enabled: diffEnabled, initialTab: sanitizedInitial },
    threshold: thresholdPlan,
    autoApplied: { rate: normalizedRate, target: thresholdPlan.autoTarget, meetsTarget },
    guard: { phaseBRequired, reviewBandCount, conflictBandCount },
  }
}

export interface DiffBackupPolicy {
  readonly enabledPrecisions: readonly MergePrecision[]
  readonly gateTab: MergeDockTabId
  readonly thresholdMs: number
}

export const diffBackupPolicy: DiffBackupPolicy = Object.freeze({
  enabledPrecisions: ['beta', 'stable'] as const,
  gateTab: 'diff',
  thresholdMs: DIFF_BACKUP_THRESHOLD_MS,
})

export const shouldShowDiffBackupCTA = (
  policy: DiffBackupPolicy,
  precision: MergePrecision,
  tab: MergeDockTabId,
  lastSuccessAt: string | undefined,
  now: number,
): boolean => {
  if (!policy.enabledPrecisions.includes(precision) || tab !== policy.gateTab || !lastSuccessAt) return false
  const ts = Date.parse(lastSuccessAt)
  return Number.isFinite(ts) && now - ts > policy.thresholdMs
}

const computeStoryboardWarnings = (storyboard: Storyboard): string[] => {
  const results: string[] = []
  for (let index = 0; index < storyboard.scenes.length; index += 1) {
    const scene = storyboard.scenes[index]!
    if (!(scene.manual || scene.ai)) {
      results.push(`#${index + 1} text empty`)
    }
    if (!scene.tone) {
      results.push(`#${index + 1} tone missing`)
    }
  }
  return results
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
  readonly flags?: Pick<FlagSnapshot, 'merge'>
  readonly mergeThreshold?: number | null
  readonly autoAppliedRate?: number | null
  readonly phaseStats?: MergeDockPhaseStats | null
  readonly workspace?: WorkspaceConfiguration | null
}

export function MergeDock(props?: MergeDockProps){
  const sb = useSB((state) => state.sb)
  const flags = props?.flags
  const autoAppliedRate = props?.autoAppliedRate ?? null
  const phaseStats = props?.phaseStats ?? null
  const storage = typeof window !== 'undefined' ? window.localStorage : undefined
  const mergeWindow = typeof window !== 'undefined' ? (window as MergeDockWindow) : undefined
  const autoSave = readAutoSaveState(mergeWindow)
  const { precision, threshold } = useMergeThreshold({
    flags: flags ?? null,
    precision: flags?.merge.precision ?? null,
    threshold: props?.mergeThreshold ?? null,
    workspace: props?.workspace ?? null,
  })
  const storedTabKey = storage?.getItem('merge.lastTab')
  const lastTab = storedTabKey && (storedTabKey === 'diff' || isBaseTabId(storedTabKey)) ? (storedTabKey as MergeDockTabId) : undefined
  const phasePlan = useMemo(
    () =>
      resolveMergeDockPhasePlan({
        precision,
        threshold,
        lastTab,
        autoAppliedRate,
        phaseStats,
      }),
    [
      precision,
      threshold,
      lastTab,
      autoAppliedRate,
      phaseStats?.reviewBandCount ?? null,
      phaseStats?.conflictBandCount ?? null,
    ],
  )
  const plan = phasePlan.tabs
  const diffPlan = phasePlan.diff
  const defaultPreference = getDefaultPreference(precision, phasePlan.diff.enabled)
  const storeRef = useRef<MergeDockViewStore>()
  if (!storeRef.current) {
    storeRef.current = createMergeDockViewStore(plan.initialTab, defaultPreference)
  }
  const store = storeRef.current
  const activeTab = useStore(store, (state) => state.activeTab)
  const preference = useStore(store, (state) => state.preference)
  const previousPrecisionRef = useRef(precision)
  useEffect(() => {
    const precisionChanged = previousPrecisionRef.current !== precision
    previousPrecisionRef.current = precision
    const nextTab = precisionChanged
      ? plan.initialTab
      : sanitizeActiveTab(activeTab, plan, phasePlan.diff.enabled)
    const basePreference = precisionChanged ? defaultPreference : preference
    const nextPreference = sanitizePreference(basePreference, precision, phasePlan.diff.enabled)
    if (nextTab !== activeTab || nextPreference !== preference) {
      store.setState({
        ...(nextTab !== activeTab ? { activeTab: nextTab } : {}),
        ...(nextPreference !== preference ? { preference: nextPreference } : {}),
      })
    }
  }, [activeTab, plan, phasePlan.diff.enabled, precision, preference, defaultPreference, store])
  useEffect(() => {
    if (!storage) return
    storage.setItem('merge.lastTab', activeTab)
  }, [activeTab, storage])

  const [compiledOverride, setCompiledOverride] = useState<string | null>(null)
  const [notice, setNotice] = useState<MergeDockNotice | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('manual')
  const notify = useCallback((level: MergeDockNotice['level'], message: string) => {
    setNotice({ level, message })
  }, [])

  const onTabChange = useCallback(
    (next: MergeDockTabId) => {
      const sanitized = sanitizeActiveTab(next, plan, phasePlan.diff.enabled)
      store.getState().setActiveTab(sanitized)
    },
    [phasePlan.diff.enabled, plan, store],
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

  const diffBackupThresholdMs = plan.diff?.backupAfterMs ?? diffBackupPolicy.thresholdMs
  const backupPolicy = { ...diffBackupPolicy, thresholdMs: diffBackupThresholdMs }
  const showBackupCTA =
    diffPlan.enabled &&
    diffPlan.exposure === 'default' &&
    !!autoSave.flushNow &&
    shouldShowDiffBackupCTA(backupPolicy, precision, activeTab, autoSave.lastSuccessAt, Date.now())

  const onImport = useCallback(
    async (file: File, mode: ImportMode) => {
      try {
        const text = await readFileAsText(file)
        const current = useSB.getState().sb
        let next: Storyboard | null = null
        if (file.name.endsWith('.jsonl')) {
          next = mergeJSONL(current, text, mode)
        } else if (file.name.endsWith('.csv')) {
          next = mergeCSV(current, text, mode)
        } else if (file.name.endsWith('.md')) {
          const blocks = text.split(/\n##\s*Cut\s+\d+/).slice(1)
          const scenes = current.scenes.map((scene, index) => {
            const body = blocks[index]?.replace(/<!--.*?-->/g, '').trim()
            if (body == null) {
              return { ...scene }
            }
            return { ...scene, [mode]: body }
          })
          next = { ...current, scenes }
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

      {activeTab === 'diff' && (
        <div
          style={{ padding: 8, display: 'grid', gap: 8 }}
          data-merge-diff-enabled={diffPlan.enabled ? 'true' : 'false'}
          data-merge-diff-exposure={diffPlan.exposure}
          data-merge-diff-initial-tab={diffPlan.initialTab}
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
          <DiffMergeView precision={precision} hunks={emptyDiffHunks} queueMergeCommand={diffMergeNoopCommand} />
        </div>
      )}

      {activeTab === 'compiled' && (
        <div>
          <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center' }}>
            <label>統合ルール:</label>
            <select value={preference} onChange={(e) => onPreferenceChange(e.target.value as MergeDockPreference)}>
              <option value="manual-first">Manual優先</option>
              <option value="ai-first">AI優先</option>
              <option value="diff-merge">差分マージ（暫定）</option>
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
                  const ts = new Date().toISOString().replace(/[:.]/g, '-')
                  const dir = `runs/${ts}`
                  await ensureDir(dir)
                  const md = toMarkdown(sb)
                  const csv = toCSV(sb)
                  const jsonl = toJSONL(sb)
                  const h = await sha256Hex(md + '\n' + csv + '\n' + jsonl)
                  await saveText(`${dir}/shotlist.md`, md)
                  await saveText(`${dir}/shotlist.csv`, csv)
                  await saveText(`${dir}/shotlist.jsonl`, jsonl)
                  await saveText(`${dir}/meta.json`, JSON.stringify({ hash: h, title: sb.title }, null, 2))
                  await saveText('runs/latest.txt', ts)
                  notify('info', `Saved snapshot to OPFS: ${dir}`)
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
                  const latest = await loadText('runs/latest.txt')
                  if (!latest) {
                    notify('error', 'No snapshot available.')
                    return
                  }
                  const md = await loadText(`runs/${latest}/shotlist.md`)
                  if (md == null) {
                    notify('error', 'Missing compiled MD in the snapshot.')
                    return
                  }
                  setCompiledOverride(md)
                  notify('info', `Restored compiled snapshot from ${latest}.`)
                } catch (error) {
                  console.error(error)
                  notify('error', 'Failed to restore compiled snapshot.')
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
