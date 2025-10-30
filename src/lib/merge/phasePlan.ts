import { BETA_THRESHOLD_DEFAULT, DEFAULT_FLAGS, STABLE_THRESHOLD_DEFAULT } from '../../config/flags'
import type { MergePlanPhase, MergePrecision } from '../merge'

export const DIFF_BACKUP_THRESHOLD_MS = 5 * 60 * 1000

const BASE_TAB_IDS = ['compiled', 'shot', 'assets', 'import', 'golden'] as const

export type BaseTabId = (typeof BASE_TAB_IDS)[number]
export type MergeDockTabId = BaseTabId | 'diff'

export type MergeDockTabPlanEntry = {
  readonly id: MergeDockTabId
  readonly label: string
  readonly badge?: 'Beta'
}

export type MergeDockDiffPlan = {
  readonly exposure: 'opt-in' | 'default'
  readonly backupAfterMs?: number
}

export type MergeDockTabPlan = {
  readonly tabs: readonly MergeDockTabPlanEntry[]
  readonly initialTab: MergeDockTabId
  readonly diff?: MergeDockDiffPlan
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
  readonly phase: MergePlanPhase
  readonly tabs: MergeDockTabPlan
  readonly diff: {
    readonly exposure: 'hidden' | 'opt-in' | 'default'
    readonly visible: boolean
    readonly enabled: boolean
    readonly initialTab: MergeDockTabId
  }
  readonly threshold: MergeThresholdPlan
  readonly autoApplied: { readonly rate: number | null; readonly target: number; readonly meetsTarget: boolean | null }
  readonly guard: { readonly phaseBRequired: boolean; readonly reviewBandCount: number | null; readonly conflictBandCount: number | null }
}

export interface DiffBackupPolicy {
  readonly enabledPrecisions: readonly MergePrecision[]
  readonly gateTab: MergeDockTabId
  readonly thresholdMs: number
}

export const isBaseTabId = (value: unknown): value is BaseTabId =>
  typeof value === 'string' && (BASE_TAB_IDS as readonly string[]).includes(value)

const BASE_TABS = Object.freeze([
  { id: 'compiled', label: 'Compiled Script' },
  { id: 'shot', label: 'Shotlist / Export' },
  { id: 'assets', label: 'Assets' },
  { id: 'import', label: 'Import' },
  { id: 'golden', label: 'Golden' },
] as const satisfies readonly MergeDockTabPlanEntry[])

const DEFAULT_THRESHOLD = DEFAULT_FLAGS.merge.profile.threshold

type MergeThresholdRule = {
  readonly phase: MergePlanPhase
  readonly diffExposure: 'hidden' | 'opt-in' | 'default'
  readonly clamp: { readonly min: number; readonly max: number | null }
  readonly autoOffset: number
  readonly autoRange: { readonly min: number; readonly max: number }
  readonly reviewBand?: { readonly below: number; readonly above: number }
  readonly conflictBand?: { readonly below: number }
  readonly slider: { readonly min: number; readonly max: number }
}

const THRESHOLD_RULES: Record<MergePrecision, MergeThresholdRule> = Object.freeze({
  legacy: {
    phase: 'phase-a',
    diffExposure: 'hidden',
    clamp: { min: 0.65, max: null },
    autoOffset: 0.08,
    autoRange: { min: 0.65, max: 0.9 },
    slider: { min: 0.65, max: 0.9 },
  },
  beta: {
    phase: 'phase-b',
    diffExposure: 'opt-in',
    clamp: { min: BETA_THRESHOLD_DEFAULT, max: 0.9 },
    autoOffset: 0.05,
    autoRange: { min: 0.8, max: 0.92 },
    reviewBand: { below: 0.02, above: 0.05 },
    conflictBand: { below: 0.02 },
    slider: { min: BETA_THRESHOLD_DEFAULT, max: 0.9 },
  },
  stable: {
    phase: 'phase-b',
    diffExposure: 'default',
    clamp: { min: STABLE_THRESHOLD_DEFAULT, max: 0.94 },
    autoOffset: 0.03,
    autoRange: { min: 0.86, max: 0.95 },
    reviewBand: { below: 0.01, above: 0.03 },
    conflictBand: { below: 0.01 },
    slider: { min: STABLE_THRESHOLD_DEFAULT, max: 0.94 },
  },
})

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

const clampValue = (value: number, min: number, max: number | null): number => {
  const upper = typeof max === 'number' ? max : 1
  return Math.min(Math.max(value, min), upper)
}

const roundRate = (value: number): number => Math.min(1, Math.max(0, Math.round(value * 100) / 100))

export const planMergeDockTabs = (precision: MergePrecision, lastTab?: MergeDockTabId): MergeDockTabPlan => {
  const plan = MERGE_DOCK_TAB_PLAN[precision]
  const requested = lastTab && (lastTab === 'diff' || isBaseTabId(lastTab)) ? lastTab : undefined
  const sanitized = requested && plan.tabs.some((entry) => entry.id === requested) ? requested : undefined
  const diffConfig = plan.diff ? { diff: plan.diff } : {}
  const initialTab = sanitized ?? plan.initialTab
  if (precision === 'stable') {
    return { tabs: plan.tabs, initialTab, ...diffConfig }
  }
  if (precision === 'legacy') {
    const initial = sanitized && sanitized !== 'diff' ? sanitized : plan.initialTab
    return { tabs: plan.tabs, initialTab: initial }
  }
  return { tabs: plan.tabs, initialTab, ...diffConfig }
}

export const resolveMergeThresholdPlan = (
  precision: MergePrecision,
  threshold: number | null | undefined,
): MergeThresholdPlan => {
  const rule = THRESHOLD_RULES[precision]
  const validInput = typeof threshold === 'number' && Number.isFinite(threshold) ? threshold : null
  const base = validInput ?? DEFAULT_THRESHOLD
  const clamped = clampValue(base, rule.clamp.min, rule.clamp.max)
  const request = roundRate(clamped)
  const autoBase = clamped + rule.autoOffset
  const { min: autoMin, max: autoMax } = rule.autoRange
  const autoTarget = roundRate(clampValue(autoBase, autoMin, autoMax))
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
  const baseTabPlan = planMergeDockTabs(precision, lastTab)
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
  const diffConfigured = !!baseTabPlan.diff && precision !== 'legacy'
  const shouldHideDiff = !diffConfigured
  let diffVisible = !shouldHideDiff
  let diffExposure: 'hidden' | 'opt-in' | 'default' = diffVisible
    ? baseTabPlan.diff?.exposure ?? 'hidden'
    : 'hidden'
  let diffTabsPlan = diffVisible && baseTabPlan.diff
    ? {
        exposure: baseTabPlan.diff.exposure,
        ...(baseTabPlan.diff.backupAfterMs ? { backupAfterMs: baseTabPlan.diff.backupAfterMs } : {}),
      }
    : undefined
  const normalizedRate = typeof autoAppliedRate === 'number' && Number.isFinite(autoAppliedRate) ? autoAppliedRate : null
  const meetsTarget = normalizedRate == null ? null : normalizedRate >= thresholdPlan.autoTarget
  const shouldDemoteDiff =
    diffConfigured && meetsTarget === false && (precision !== 'stable' || phaseBRequired)

  let tabPlanSource: MergeDockTabPlan = baseTabPlan

  if (shouldDemoteDiff && precision === 'stable') {
    const demotedPlan = planMergeDockTabs('beta', lastTab)
    tabPlanSource = demotedPlan
  }

  if (!shouldHideDiff && shouldDemoteDiff) {
    if (precision === 'stable') {
      diffVisible = true
    }
    diffTabsPlan = { exposure: 'opt-in' }
    diffExposure = 'opt-in'
  }

  const diffEnabled = diffVisible && phaseBRequired && !shouldDemoteDiff

  const tabEntries = tabPlanSource.tabs
  const effectiveTabs = diffVisible ? tabEntries : tabEntries.filter((entry) => entry.id !== 'diff')
  const compiledInitial = effectiveTabs.find((entry) => entry.id === 'compiled')?.id
  const defaultInitial = compiledInitial ?? effectiveTabs[0]?.id ?? tabPlanSource.initialTab
  const demotedInitial = shouldDemoteDiff && compiledInitial ? compiledInitial : undefined
  const resetInitial =
    !demotedInitial && tabPlanSource.initialTab && effectiveTabs.some((entry) => entry.id === tabPlanSource.initialTab)
      ? tabPlanSource.initialTab
      : undefined
  const effectiveInitial = demotedInitial ?? resetInitial ?? defaultInitial

  return {
    precision,
    phase: rule.phase,
    tabs: { tabs: effectiveTabs, initialTab: effectiveInitial, diff: diffTabsPlan },
    diff: { exposure: diffExposure, visible: diffVisible, enabled: diffEnabled, initialTab: effectiveInitial },
    threshold: thresholdPlan,
    autoApplied: { rate: normalizedRate, target: thresholdPlan.autoTarget, meetsTarget },
    guard: { phaseBRequired, reviewBandCount, conflictBandCount },
  }
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
