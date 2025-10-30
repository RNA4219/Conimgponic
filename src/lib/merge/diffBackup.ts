import type { MergePrecision } from '../merge'
import {
  shouldShowDiffBackupCTA,
  type DiffBackupPolicy,
  type MergeDockPhasePlan,
  type MergeDockTabId,
  type MergeDockTabPlan,
} from './phasePlan'

export type DiffBackupAutoSaveState = {
  readonly flushNow?: () => void
  readonly lastSuccessAt?: string
}

export type DiffBackupCTAContext = {
  readonly diffPlan: MergeDockPhasePlan['diff']
  readonly tabPlan: MergeDockTabPlan
  readonly policy: DiffBackupPolicy
  readonly precision: MergePrecision
  readonly activeTab: MergeDockTabId
  readonly autoSave: DiffBackupAutoSaveState
  readonly now: number
}

export const resolveDiffBackupPolicy = (
  tabPlan: MergeDockTabPlan,
  policy: DiffBackupPolicy,
): DiffBackupPolicy => ({
  ...policy,
  thresholdMs: tabPlan.diff?.backupAfterMs ?? policy.thresholdMs,
})

export const isDiffBackupCTAEligible = (
  diffPlan: MergeDockPhasePlan['diff'],
  precision: MergePrecision,
): boolean => diffPlan.enabled && precision !== 'legacy'

export const shouldRenderDiffBackupCTA = ({
  diffPlan,
  tabPlan,
  policy,
  precision,
  activeTab,
  autoSave,
  now,
}: DiffBackupCTAContext): boolean => {
  if (!isDiffBackupCTAEligible(diffPlan, precision)) return false
  if (typeof autoSave.flushNow !== 'function') return false
  const resolvedPolicy = resolveDiffBackupPolicy(tabPlan, policy)
  return shouldShowDiffBackupCTA(resolvedPolicy, precision, activeTab, autoSave.lastSuccessAt, now)
}

export type DiffInteractionGuardContext = {
  readonly diffPlan: MergeDockPhasePlan['diff']
  readonly guard: MergeDockPhasePlan['guard']
}

export const shouldEnableDiffInteraction = ({
  diffPlan,
  guard,
}: DiffInteractionGuardContext): boolean => {
  if (!diffPlan.visible) return false
  if (!diffPlan.enabled) return false
  if (!guard.phaseBRequired) return false
  return true
}
