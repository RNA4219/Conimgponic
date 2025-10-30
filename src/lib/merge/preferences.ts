import type { MergeDockPhasePlan, MergeDockTabId, MergeDockTabPlan } from './phasePlan'
import type { MergePrecision } from '../merge'

export type MergeDockPreference = 'manual-first' | 'ai-first' | 'diff-merge'

export const getDefaultPreference = (
  precision: MergePrecision,
  diffEnabled: boolean,
): MergeDockPreference => {
  if (precision === 'stable') {
    return 'diff-merge'
  }
  if (!diffEnabled) {
    return 'manual-first'
  }
  if (precision === 'legacy') {
    return 'manual-first'
  }
  return 'diff-merge'
}

export const sanitizePreference = (
  preference: MergeDockPreference,
  precision: MergePrecision,
  diffEnabled: boolean,
): MergeDockPreference => {
  if (precision === 'stable') {
    if (!diffEnabled && preference === 'diff-merge') {
      return 'diff-merge'
    }
    return preference
  }
  if (!diffEnabled) {
    return 'manual-first'
  }
  return preference
}

export interface ResolvePreferenceSelectionInput {
  readonly precision: MergePrecision
  readonly previousPrecision: MergePrecision
  readonly diffEnabled: boolean
  readonly previousDiffEnabled: boolean
  readonly preference: MergeDockPreference
  readonly defaultPreference: MergeDockPreference
}

export const resolvePreferenceSelection = ({
  precision,
  previousPrecision,
  diffEnabled,
  previousDiffEnabled,
  preference,
  defaultPreference,
}: ResolvePreferenceSelectionInput): MergeDockPreference => {
  const precisionChanged = previousPrecision !== precision
  const diffStateChanged = previousDiffEnabled !== diffEnabled
  const sanitizedDefault = diffEnabled
    ? sanitizePreference(defaultPreference, precision, diffEnabled)
    : defaultPreference
  const sanitizedPreference = sanitizePreference(preference, precision, diffEnabled)

  if (precisionChanged) {
    return sanitizedDefault
  }
  if (diffStateChanged) {
    if (!diffEnabled) {
      return sanitizedPreference
    }
    if (!previousDiffEnabled && sanitizedPreference !== sanitizedDefault) {
      return sanitizedPreference
    }
    return sanitizedDefault
  }
  return sanitizedPreference
}

export const sanitizeMergeDockActiveTab = (
  tab: MergeDockTabId,
  plan: MergeDockTabPlan,
  diffVisible: boolean,
  diffEnabled: boolean,
): MergeDockTabId => {
  if (!plan.tabs.some((entry) => entry.id === tab)) return plan.initialTab
  if (tab === 'diff' && (!diffVisible || !diffEnabled)) return plan.initialTab
  return tab
}

export interface ResolveActiveTabTransitionInput {
  readonly precision: MergePrecision
  readonly previousPrecision: MergePrecision
  readonly plan: MergeDockPhasePlan['tabs']
  readonly activeTab: MergeDockPhasePlan['tabs']['initialTab']
  readonly diffVisible: boolean
  readonly diffEnabled: boolean
  readonly previousDiffEnabled: boolean
}

export const resolveActiveTabTransition = ({
  precision,
  previousPrecision,
  plan,
  activeTab,
  diffVisible,
  diffEnabled,
  previousDiffEnabled,
}: ResolveActiveTabTransitionInput): MergeDockPhasePlan['tabs']['initialTab'] => {
  if (previousPrecision !== precision) {
    return plan.initialTab
  }
  if (previousDiffEnabled !== diffEnabled) {
    if (!diffEnabled) {
      return plan.initialTab
    }
    if (!previousDiffEnabled) {
      return plan.initialTab
    }
  }
  return sanitizeMergeDockActiveTab(activeTab, plan, diffVisible, diffEnabled)
}
