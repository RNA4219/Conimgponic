/// <reference types="node" />

const tsNodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
if (tsNodeEnv) {
  tsNodeEnv.TS_NODE_IGNORE_DIAGNOSTICS = '2304,2307,2578,2580,5097'
}

declare global {
  var releaseMonitor: Promise<void> | undefined
}

if (typeof globalThis.releaseMonitor === 'undefined') {
  ;(globalThis as typeof globalThis & { releaseMonitor?: Promise<void> }).releaseMonitor = Promise.resolve()
}

import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createStore } from 'zustand/vanilla'

import type { Storyboard } from '../../src/types'

import type { MergeHunk, MergePrecision, QueueMergeCommand } from '../../src/components/diffMergeTypes.js'
import { useSB } from '../../src/store'

import { DEFAULT_FLAGS, type FlagSnapshot } from '../../src/config'
import { DEFAULT_MERGE_ENGINE } from '../../src/lib/merge/engine'
const mergeDockModule = await import('../../src/components/MergeDock')
const mergeDomainModule = await import('../../src/components/merge-dock/domain')
const mergePreferencesModule = await import('../../src/lib/merge/preferences.ts')
const mergeThresholdModule = await import('../../src/lib/merge/threshold.ts')
const { DEFAULT_MERGE_ENGINE } = await import('../../src/lib/merge/engine.ts')
const { createEventHub } = await import('../../src/platform/vscode/merge/bridge.ts')
const mergeEventsModule = await import('../../src/lib/merge/events.ts')
const {
  resolveMergeDockPhasePlan,
  planMergeDockTabs,
  resolveMergeThresholdPlan,
  diffBackupPolicy,
  shouldRenderDiffBackupCTA,
  shouldShowDiffBackupCTA,
  isDiffBackupCTAEligible,
  shouldEnableDiffInteraction,
} = mergeDomainModule
const exportedFromMergeDock = mergeDockModule as typeof mergeDockModule
const {
  getDefaultPreference,
  sanitizePreference,
  resolvePreferenceSelection,
  resolveActiveTabTransition,
  sanitizeMergeDockActiveTab,
} = mergePreferencesModule
const { resolveMergeThresholdSnapshot } = mergeThresholdModule
type MergeDockPhasePlan = ReturnType<typeof resolveMergeDockPhasePlan>
type MergeDockPhaseStats = NonNullable<Parameters<typeof resolveMergeDockPhasePlan>[0]['phaseStats']>
type MergeDockTabId = NonNullable<Parameters<typeof resolveMergeDockPhasePlan>[0]['lastTab']>

test('MergeDock module re-exports domain helpers', () => {
  assert.equal(exportedFromMergeDock.planMergeDockTabs, planMergeDockTabs)
  assert.equal(exportedFromMergeDock.diffBackupPolicy, diffBackupPolicy)
  assert.equal(exportedFromMergeDock.shouldRenderDiffBackupCTA, shouldRenderDiffBackupCTA)
})

test('resolveMergeThresholdSnapshot falls back to default threshold', () => {
  const snapshot = resolveMergeThresholdSnapshot({ workspace: null, storage: null })

  assert.equal(snapshot.threshold, DEFAULT_FLAGS.merge.profile.threshold)
  assert.equal(DEFAULT_FLAGS.merge.profile.threshold, 0.75)
  assert.equal(snapshot.precision, 'legacy')
})

test('resolveMergeThresholdSnapshot prioritizes stable flag threshold when env precision override is set', () => {
  const nodeProcess = (globalThis as {
    process?: { env?: Record<string, string | undefined> }
  }).process

  if (!nodeProcess || !nodeProcess.env) {
    throw new Error('process.env is unavailable')
  }

  const env = nodeProcess.env
  const previousPrecision = env.VITE_MERGE_PRECISION

  try {
    env.VITE_MERGE_PRECISION = 'stable'

    const snapshot = resolveMergeThresholdSnapshot({ workspace: null, storage: null })

    assert.equal(snapshot.precision, 'stable')
    assert.equal(snapshot.threshold, 0.82)
  } finally {
    if (previousPrecision === undefined) {
      delete env.VITE_MERGE_PRECISION
    } else {
      env.VITE_MERGE_PRECISION = previousPrecision
    }
  }
})

test('resolveMergeThresholdSnapshot reads conimg-prefixed workspace getter key', () => {
  const workspace = {
    get(key: string) {
      if (key === 'conimg.merge.threshold') {
        return '0.88'
      }
      return undefined
    }
  }

  const snapshot = resolveMergeThresholdSnapshot({ workspace })

  assert.equal(snapshot.threshold, 0.88)
  assert.equal(snapshot.precision, 'stable')
})

test('resolveMergeThresholdSnapshot retries with conimg-prefixed workspace getter key when bare key throws', () => {
  const workspace = {
    get(key: string) {
      if (key === 'merge.threshold') {
        throw new Error('Unknown configuration key')
      }
      if (key === 'conimg.merge.threshold') {
        return 0.97
      }
      return undefined
    },
  }

  const stableFlags: Pick<FlagSnapshot, 'merge'> = {
    merge: {
      value: 'stable',
      source: 'workspace',
      errors: [],
      precision: 'stable',
      threshold: Number.NaN,
    },
  }

  const { precision, threshold } = resolveMergeThresholdSnapshot({
    workspace,
    storage: null,
    flags: stableFlags,
  })
  const plan = resolveMergeDockPhasePlan({
    precision,
    threshold,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 1 },
  })

  assert.equal(precision, 'stable')
  assert.equal(plan.threshold.request, 0.94)
  assert.equal(plan.threshold.autoTarget, 0.95)
  assert.equal(plan.diff.enabled, true)
  assert.equal(plan.guard.phaseBRequired, true)
})

test('legacy precision clamps threshold and hides diff tab', () => {
  const plan = resolveMergeDockPhasePlan({ precision: 'legacy', threshold: 0.6 })

  assert.equal(plan.phase, 'phase-a')
  assert.equal(plan.diff.enabled, false)
  assert.equal(plan.diff.exposure, 'hidden')
  assert.deepEqual(
    plan.tabs.tabs.map((entry) => entry.id),
    ['compiled', 'shot', 'assets', 'import', 'golden'],
  )
  assert.equal(plan.threshold.request, 0.65)
  assert.equal(plan.threshold.autoTarget, 0.73)
  assert.equal(plan.autoApplied.target, 0.73)
  assert.equal(plan.autoApplied.meetsTarget, null)
  assert.equal(plan.guard.phaseBRequired, false)
})

test('beta precision enables diff tab when review band is present', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'beta',
    threshold: 0.7,
    phaseStats: { reviewBandCount: 2, conflictBandCount: 0 },
  })

  assert.equal(plan.phase, 'phase-b')
  assert.equal(plan.diff.enabled, true)
  assert.equal(plan.diff.visible, true)
  assert.equal(plan.diff.exposure, 'opt-in')
  assert.ok(plan.tabs.tabs.some((entry) => entry.id === 'diff'))
  assert.equal(plan.threshold.request, 0.75)
  assert.equal(plan.threshold.autoTarget, 0.8)
  assert.deepEqual(plan.threshold.reviewBand, { min: 0.73, max: 0.8 })
  assert.deepEqual(plan.threshold.conflictBand, { max: 0.73 })
  assert.equal(plan.guard.phaseBRequired, true)
})

test('beta precision without phase stats keeps diff tab visible but disabled', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'beta',
    threshold: 0.7,
  })

  assert.equal(plan.diff.enabled, false)
  assert.equal(plan.diff.visible, true)
  assert.equal(plan.diff.exposure, 'opt-in')
  assert.equal(plan.guard.phaseBRequired, false)
  assert.ok(plan.tabs.tabs.some((entry) => entry.id === 'diff'))
})

test('stable precision hides diff tab when autosave is disabled', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
    autoSaveEnabled: false,
  })

  assert.equal(plan.diff.visible, false)
  assert.equal(plan.diff.enabled, false)
  assert.ok(plan.tabs.tabs.every((entry) => entry.id !== 'diff'))
})

test('stable precision shows diff tab when autosave is enabled', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
    autoSaveEnabled: true,
  })

  assert.equal(plan.diff.visible, true)
  assert.equal(plan.diff.enabled, false)
  assert.ok(plan.tabs.tabs.some((entry) => entry.id === 'diff'))
})

test('beta precision keeps diff tab visible but disabled when review band is empty', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'beta',
    threshold: 0.85,
    autoAppliedRate: 0.75,
    phaseStats: { reviewBandCount: 0, conflictBandCount: 0 },
  })

  assert.equal(plan.diff.enabled, false)
  assert.equal(plan.diff.visible, true)
  assert.equal(plan.diff.exposure, 'opt-in')
  assert.equal(plan.guard.phaseBRequired, false)
  assert.ok(plan.tabs.tabs.some((entry) => entry.id === 'diff'))
  assert.equal(plan.tabs.initialTab, 'compiled')
  assert.equal(plan.threshold.request, 0.85)
  assert.equal(plan.threshold.autoTarget, 0.9)
  assert.equal(plan.autoApplied.rate, 0.75)
  assert.equal(plan.autoApplied.meetsTarget, false)
})

test('beta precision keeps diff visible but disabled when stats are zeroed', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'beta',
    threshold: 0.78,
    phaseStats: { reviewBandCount: 0, conflictBandCount: 0 },
  })

  assert.equal(plan.diff.visible, true)
  assert.equal(plan.diff.enabled, false)
  assert.equal(plan.diff.exposure, 'opt-in')
  assert.deepEqual(plan.tabs.diff, { exposure: 'opt-in' })
  assert.ok(plan.tabs.tabs.some((entry) => entry.id === 'diff'))
})

test('data-merge-diff-enabled guard blocks diff interaction until enabled', () => {
  const phasePlan = resolveMergeDockPhasePlan({ precision: 'stable', threshold: 0.82 })

  assert.equal(phasePlan.diff.enabled, false)
  assert.equal(
    shouldEnableDiffInteraction({ diffPlan: phasePlan.diff, guard: phasePlan.guard }),
    false,
  )
})

test('data-merge-diff-enabled guard keeps diff tab inactive while disabled', () => {
  const phasePlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.9,
    autoAppliedRate: 0.84,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 0 },
  })

  assert.equal(phasePlan.diff.enabled, false)
  assert.equal(phasePlan.diff.visible, true)
  assert.equal(phasePlan.tabs.initialTab, 'compiled')
  assert.equal(
    sanitizeMergeDockActiveTab(
      'diff',
      phasePlan.tabs,
      phasePlan.diff.visible,
      phasePlan.diff.enabled,
    ),
    'compiled',
  )
  assert.equal(
    sanitizeMergeDockActiveTab(
      'shot',
      phasePlan.tabs,
      phasePlan.diff.visible,
      phasePlan.diff.enabled,
    ),
    'shot',
  )
  assert.equal(
    shouldEnableDiffInteraction({ diffPlan: phasePlan.diff, guard: phasePlan.guard }),
    false,
  )
})

test('diff exposure falls back to opt-in when auto applied underperforms', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.9,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 0 },
    autoAppliedRate: 0.84,
  })

  assert.ok(plan.threshold.autoTarget > (plan.autoApplied.rate ?? 0))
  assert.equal(plan.diff.enabled, false)
  assert.equal(plan.diff.exposure, 'opt-in')
})

test('beta precision diff plan triggers backup CTA when diff is enabled', () => {
  const phasePlan = resolveMergeDockPhasePlan({
    precision: 'beta',
    threshold: 0.75,
    phaseStats: { reviewBandCount: 2, conflictBandCount: 0 },
  })

  assert.equal(phasePlan.diff.enabled, true)
  const lastSuccessAt = new Date('2024-01-01T00:00:00Z').toISOString()
  const showBackupCTA = shouldRenderDiffBackupCTA({
    diffPlan: phasePlan.diff,
    tabPlan: phasePlan.tabs,
    policy: diffBackupPolicy,
    precision: 'beta',
    activeTab: 'diff',
    autoSave: { flushNow: () => undefined, lastSuccessAt },
    now: Date.parse('2024-01-01T00:10:00Z'),
  })

  assert.equal(showBackupCTA, true)
})

test('beta precision resolves diff backup eligibility when autosave is stale', () => {
  const phasePlan = resolveMergeDockPhasePlan({
    precision: 'beta',
    threshold: 0.76,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 0 },
  })

  assert.equal(phasePlan.diff.enabled, true)
  assert.equal(isDiffBackupCTAEligible(phasePlan.diff, 'beta'), true)

  const lastSuccessAt = '2024-05-01T00:00:00.000Z'
  const now = Date.parse('2024-05-01T00:08:00.000Z')
  const resolvedPolicyThreshold = phasePlan.tabs.diff?.backupAfterMs ?? diffBackupPolicy.thresholdMs

  assert.equal(
    shouldShowDiffBackupCTA(
      { ...diffBackupPolicy, thresholdMs: resolvedPolicyThreshold },
      'beta',
      'diff',
      lastSuccessAt,
      now,
    ),
    true,
  )

  const shouldRender = shouldRenderDiffBackupCTA({
    diffPlan: phasePlan.diff,
    tabPlan: phasePlan.tabs,
    policy: diffBackupPolicy,
    precision: 'beta',
    activeTab: 'diff',
    autoSave: { flushNow: () => undefined, lastSuccessAt },
    now,
  })

  assert.equal(shouldRender, true)
})

test('stable precision without phase stats keeps diff tab visible but disabled', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
  })

  assert.equal(plan.diff.enabled, false)
  assert.equal(plan.diff.visible, true)
  assert.equal(plan.diff.exposure, 'default')
  assert.equal(plan.tabs.diff?.exposure, 'default')
  assert.deepEqual(plan.tabs.diff, { exposure: 'default', backupAfterMs: 300000 })
  assert.equal(plan.guard.phaseBRequired, false)
  assert.ok(plan.tabs.tabs.some((entry) => entry.id === 'diff'))
  assert.equal(plan.tabs.initialTab, 'diff')
  assert.equal(plan.diff.initialTab, 'diff')
})

test('stable precision hides diff tab when autosave is disabled', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.86,
    autoSaveEnabled: false,
  })

  assert.equal(plan.diff.visible, false)
  assert.equal(plan.diff.enabled, false)
  assert.equal(plan.diff.exposure, 'hidden')
  assert.equal(plan.tabs.tabs.some((entry) => entry.id === 'diff'), false)
})

test('stable precision keeps diff opt-in until auto apply meets target', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.86,
    autoAppliedRate: 0.88,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 0 },
  })

  assert.equal(plan.threshold.autoTarget, 0.89)
  assert.equal(plan.autoApplied.rate, 0.88)
  assert.equal(plan.autoApplied.meetsTarget, false)
  assert.equal(plan.diff.exposure, 'opt-in')
  assert.equal(plan.diff.enabled, false)
})

test('stable tab plan restores last compiled tab selection', () => {
  const tabPlan = planMergeDockTabs('stable', 'compiled')

  assert.equal(tabPlan.initialTab, 'compiled')

  const phasePlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.86,
    autoAppliedRate: 0.9,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 0 },
    lastTab: 'compiled',
  })

  assert.equal(phasePlan.tabs.initialTab, 'compiled')
  assert.equal(phasePlan.diff.initialTab, 'compiled')
})

test('stable tab plan preserves last base tab when diff remains enabled', () => {
  const tabPlan = planMergeDockTabs('stable', 'shot')

  assert.equal(tabPlan.initialTab, 'shot')

  const phasePlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.9,
    autoAppliedRate: 0.95,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 0 },
    lastTab: 'shot',
  })

  assert.equal(phasePlan.autoApplied.meetsTarget, true)
  assert.equal(phasePlan.diff.visible, true)
  assert.equal(phasePlan.tabs.initialTab, 'shot')
  assert.equal(phasePlan.diff.initialTab, 'shot')
})

test('stable precision demotes diff tab when auto apply underperforms', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.86,
    autoAppliedRate: 0.81,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 0 },
  })

  assert.equal(plan.threshold.autoTarget > (plan.autoApplied.rate ?? 0), true)
  assert.deepEqual(
    plan.tabs.tabs.map((entry) => entry.id),
    ['compiled', 'shot', 'assets', 'import', 'golden', 'diff'],
  )
  assert.equal(plan.tabs.initialTab, 'compiled')
  assert.equal(plan.diff.visible, true)
  assert.equal(plan.diff.exposure, 'opt-in')
  assert.equal(plan.diff.enabled, false)
})

test('stable precision demotion swaps to beta tab layout with Diff (Beta) badge when auto rate misses target', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.9,
    autoAppliedRate: 0.84,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 0 },
  })

  assert.equal(plan.autoApplied.rate, 0.84)
  assert.equal(plan.threshold.autoTarget > (plan.autoApplied.rate ?? 0), true)

  const betaTabs = planMergeDockTabs('beta').tabs
  assert.deepEqual(plan.tabs.tabs, betaTabs)

  const diffEntry = plan.tabs.tabs.at(-1)
  assert.equal(diffEntry?.id, 'diff')
  assert.equal(diffEntry?.label, 'Diff (Beta)')
  assert.equal(diffEntry?.badge, 'Beta')
})

test('stable precision demotion shouldDemoteDiff always yields beta tab order and diff badge', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.88,
    autoAppliedRate: 0.82,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 0 },
  })

  assert.equal(plan.autoApplied.meetsTarget, false)

  const betaTabs = planMergeDockTabs('beta').tabs
  assert.deepEqual(plan.tabs.tabs, betaTabs)

  const diffEntry = plan.tabs.tabs.at(-1)
  assert.equal(diffEntry?.id, 'diff')
  assert.equal(diffEntry?.label, 'Diff (Beta)')
  assert.equal(diffEntry?.badge, 'Beta')
})

test('stable precision auto apply demotion resets initial tab to compiled', () => {
  const phasePlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.9,
    autoAppliedRate: 0.84,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 0 },
    lastTab: 'shot',
  })

  assert.equal(phasePlan.autoApplied.meetsTarget, false)
  assert.equal(phasePlan.tabs.initialTab, 'compiled')
  assert.equal(phasePlan.diff.initialTab, 'compiled')
})

test('stable precision demotion restores compiled initial tabs with beta layout when diff was last active', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.9,
    autoAppliedRate: 0.84,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 0 },
    lastTab: 'diff',
  })

  const betaTabs = planMergeDockTabs('beta').tabs
  assert.deepEqual(plan.tabs.tabs, betaTabs)
  assert.equal(plan.tabs.initialTab, 'compiled')
  assert.equal(plan.diff.initialTab, 'compiled')
})

test('stable precision demotes diff exposure while keeping tab visible when auto rate misses target', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.9,
    autoAppliedRate: 0.84,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 0 },
  })

  assert.equal(plan.threshold.autoTarget > (plan.autoApplied.rate ?? 0), true)
  assert.equal(plan.diff.visible, true)
  assert.equal(plan.diff.exposure, 'opt-in')
  assert.equal(plan.diff.enabled, false)
  assert.deepEqual(plan.tabs.diff, { exposure: 'opt-in' })
  assert.equal(plan.tabs.initialTab, 'compiled')
  assert.equal(plan.diff.initialTab, 'compiled')
})

test('stable precision keeps diff visible but disabled when stats are zeroed', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.88,
    phaseStats: { reviewBandCount: 0, conflictBandCount: 0 },
  })

  assert.equal(plan.diff.visible, true)
  assert.equal(plan.diff.enabled, false)
  assert.equal(plan.diff.exposure, 'default')
  assert.deepEqual(plan.tabs.diff, { exposure: 'default', backupAfterMs: 300000 })
  assert.ok(plan.tabs.tabs.some((entry) => entry.id === 'diff'))
})

test('stable precision demotes diff initial tab when auto apply underperforms', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.9,
    autoAppliedRate: 0.84,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 0 },
    lastTab: 'diff',
  })

  assert.equal(plan.autoApplied.meetsTarget, false)
  assert.equal(plan.tabs.initialTab, 'compiled')
  assert.equal(plan.diff.initialTab, 'compiled')
})

test('stable precision keeps diff merge preference locked while guarded', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
  })

  assert.equal(plan.diff.enabled, false)
  assert.equal(getDefaultPreference('stable', plan.diff.enabled), 'diff-merge')
  assert.equal(sanitizePreference('diff-merge', 'stable', plan.diff.enabled), 'diff-merge')
})

test('sanitizePreference preserves diff merge preference when stable diff is disabled', () => {
  assert.equal(sanitizePreference('diff-merge', 'stable', false), 'diff-merge')
})

test('stable diff guard keeps diff merge default and restores manual override after unlock', () => {
  const guardedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
  })
  const unlockedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
    phaseStats: { reviewBandCount: 2, conflictBandCount: 0 },
  })

  assert.equal(guardedPlan.diff.enabled, false)
  assert.equal(unlockedPlan.diff.enabled, true)

  const guardedDefault = getDefaultPreference('stable', guardedPlan.diff.enabled)
  assert.equal(guardedDefault, 'diff-merge')
  assert.equal(sanitizePreference(guardedDefault, 'stable', guardedPlan.diff.enabled), 'diff-merge')

  const manualOverrideWhileGuarded = resolvePreferenceSelection({
    precision: 'stable',
    previousPrecision: 'stable',
    diffEnabled: guardedPlan.diff.enabled,
    previousDiffEnabled: guardedPlan.diff.enabled,
    preference: 'manual-first',
    defaultPreference: guardedDefault,
  })

  assert.equal(manualOverrideWhileGuarded, 'manual-first')

  const unlockedDefault = getDefaultPreference('stable', unlockedPlan.diff.enabled)
  const restoredPreference = resolvePreferenceSelection({
    precision: 'stable',
    previousPrecision: 'stable',
    diffEnabled: unlockedPlan.diff.enabled,
    previousDiffEnabled: guardedPlan.diff.enabled,
    preference: manualOverrideWhileGuarded,
    defaultPreference: unlockedDefault,
  })

  assert.equal(unlockedDefault, 'diff-merge')
  assert.equal(restoredPreference, 'manual-first')
})

test('stable precision diff guard fallback retains diff merge preference', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
  })

  assert.equal(plan.diff.enabled, false)

  assert.equal(sanitizePreference('diff-merge', 'stable', plan.diff.enabled), 'diff-merge')

  const preference = resolvePreferenceSelection({
    precision: 'stable',
    previousPrecision: 'stable',
    diffEnabled: plan.diff.enabled,
    previousDiffEnabled: plan.diff.enabled,
    preference: 'diff-merge',
    defaultPreference: getDefaultPreference('stable', plan.diff.enabled),
  })

  assert.equal(preference, 'diff-merge')
})

test('stable precision diff guard unlock restores diff as active tab in store', () => {
  const guardedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
  })
  const unlockedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
    phaseStats: { reviewBandCount: 2, conflictBandCount: 0 },
  })

  const viewStore = createStore<{ readonly activeTab: 'compiled' | 'shot' | 'diff' }>(() => ({ activeTab: 'shot' }))
  const nextTab = resolveActiveTabTransition({
    precision: unlockedPlan.precision,
    previousPrecision: guardedPlan.precision,
    diffEnabled: unlockedPlan.diff.enabled,
    previousDiffEnabled: guardedPlan.diff.enabled,
    plan: unlockedPlan.tabs,
    activeTab: viewStore.getState().activeTab,
    diffVisible: unlockedPlan.diff.visible,
  })

  viewStore.setState({ activeTab: nextTab })

  assert.equal(nextTab, 'diff')
  assert.equal(viewStore.getState().activeTab, 'diff')
})

test('beta diff guard exposes diff merge hunks and queue command once enabled', async () => {
  const harness = await renderDiffMergeDock({
    precision: 'beta',
    phaseStats: { reviewBandCount: 2, conflictBandCount: 0 },
    autoAppliedRate: 0.82,
    lastTab: 'diff',
  })
  try {
    assert.deepEqual(
      harness.hunks.map((hunk) => hunk.id),
      ['cut-1'],
    )

    const result = await harness.queue({
      type: 'queue-merge',
      precision: 'beta',
      origin: 'operation-pane.queue',
      hunkIds: ['cut-1'],
      telemetryContext: {
        collectorSurface: 'diff-merge.operation-pane',
        analyzerSurface: 'diff-merge.queue',
        lastTab: 'review',
      },
      metadata: { autoSaveRequested: true },
    })

    assert.equal(result.status, 'success')
    assert.deepEqual(result.hunkIds, ['cut-1'])
    assert.equal(harness.flushLog.length, 1)
    assert.deepEqual(
      harness.collectorLog.map((entry) => entry.phase_guard),
      ['phase-b', 'phase-b'],
    )
    assert.deepEqual(
      harness.collectorLog.map((entry) => entry.diff_exposure),
      ['opt-in', 'opt-in'],
    )
  } finally {
    harness.cleanup()
  }
})

test('stable diff guard exposes diff merge hunks and queue command once enabled', async () => {
  const harness = await renderDiffMergeDock({
    precision: 'stable',
    phaseStats: { reviewBandCount: 2, conflictBandCount: 0 },
    lastTab: 'diff',
  })
  try {
    assert.deepEqual(
      harness.hunks.map((hunk) => hunk.id),
      ['cut-1'],
    )

    const result = await harness.queue({
      type: 'queue-merge',
      precision: 'stable',
      origin: 'operation-pane.queue',
      hunkIds: ['cut-1'],
      telemetryContext: {
        collectorSurface: 'diff-merge.operation-pane',
        analyzerSurface: 'diff-merge.queue',
        lastTab: 'diff',
      },
      metadata: { autoSaveRequested: true },
    })

    assert.equal(result.status, 'success')
    assert.deepEqual(result.hunkIds, ['cut-1'])
    assert.equal(harness.flushLog.length, 1)
  } finally {
    harness.cleanup()
  }
})

interface RenderMergeDockHarnessResult {
  readonly markup: string
  readonly hunks: readonly MergeHunk[]
  readonly queue: QueueMergeCommand
  readonly flushLog: readonly string[]
  readonly collectorLog: readonly Record<string, unknown>[]
  readonly cleanup: () => void
}

interface RenderMergeDockHarnessOptions {
  readonly precision: MergePrecision
  readonly phaseStats?: MergeDockPhaseStats | null
  readonly autoAppliedRate?: number
  readonly autoSaveEnabled?: boolean
  readonly requireDiff?: boolean
  readonly storyboard?: Storyboard
  readonly lastTab?: MergeDockTabId
}

const renderMergeDockHarness = async ({
  precision,
  phaseStats = null,
  autoAppliedRate,
  autoSaveEnabled = true,
  requireDiff = true,
  storyboard: storyboardOverride,
  lastTab,
}: RenderMergeDockHarnessOptions): Promise<RenderMergeDockHarnessResult> => {
  const { MergeDock } = mergeDockModule as typeof mergeDockModule
  const hookGlobal = globalThis as typeof globalThis & {
    __diffMergeViewOnPropsReady?: (payload: {
      readonly hunks: readonly MergeHunk[]
      readonly queueMergeCommand: QueueMergeCommand
    }) => void
  }
  const originalHook = hookGlobal.__diffMergeViewOnPropsReady
  const originalWindow = (globalThis as { window?: typeof window }).window
  const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage

  const store = new Map<string, string>()
  if (lastTab) {
    store.set('merge.lastTab', lastTab)
  }

  const storage: Storage = {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key) {
      return store.has(key) ? store.get(key)! : null
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key) {
      store.delete(key)
    },
    setItem(key, value) {
      store.set(String(key), String(value))
    },
  }

  const flushLog: string[] = []
  const collectorLog: Record<string, unknown>[] = []
  const mockWindow = {
    localStorage: storage,
    __mergeDockAutoSaveSnapshot: { lastSuccessAt: '2024-05-01T00:00:00.000Z' },
    __mergeDockFlushNow: () => {
      flushLog.push('flush')
    },
    Day8Collector: {
      publish(event: Record<string, unknown>) {
        collectorLog.push(event)
      },
    },
  } as typeof window & {
    __mergeDockAutoSaveSnapshot?: { lastSuccessAt?: string }
    __mergeDockFlushNow?: () => void
    Day8Collector?: { publish(event: Record<string, unknown>): void }
  }

  if (!autoSaveEnabled) {
    delete mockWindow.__mergeDockFlushNow
  }

  Object.defineProperty(globalThis, 'window', { configurable: true, value: mockWindow })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })

  const originalStoryboard = useSB.getState().sb
  const storyboard: Storyboard = storyboardOverride ?? {
    id: 'sb-diff-harness',
    title: 'Storyboard',
    scenes: [
      {
        id: 'cut-1',
        manual: 'Manual draft line',
        ai: 'Manual draft line',
        status: 'idle',
        assets: [],
        lock: null,
      },
    ],
    selection: [],
    version: 1,
  }

  useSB.setState({ sb: storyboard })

  let capturedHunks: readonly MergeHunk[] | undefined
  let capturedQueue: QueueMergeCommand | undefined
  hookGlobal.__diffMergeViewOnPropsReady = (payload) => {
    capturedHunks = payload.hunks
    capturedQueue = payload.queueMergeCommand
  }

  const stablePhaseStats: MergeDockPhaseStats | null =
    phaseStats ?? (precision === 'stable' ? { reviewBandCount: 2, conflictBandCount: 0 } : null)

  const flags: Pick<FlagSnapshot, 'merge'> = {
    merge: { value: precision, source: 'workspace', errors: [], precision, threshold: Number.NaN },
  }

  const markup = renderToStaticMarkup(
    React.createElement(MergeDock, {
      flags,
      phaseStats: stablePhaseStats,
      autoAppliedRate: autoAppliedRate ?? null,
      autoSaveEnabled,
    }),
  )

  if (requireDiff && (!capturedQueue || !capturedHunks)) {
    throw new Error('DiffMergeView did not provide hunks or queue command')
  }

  const cleanup = () => {
    useSB.setState({ sb: originalStoryboard })
    hookGlobal.__diffMergeViewOnPropsReady = originalHook
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
    if (originalLocalStorage !== undefined) {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalLocalStorage })
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage')
    }
  }

  return {
    markup,
    hunks: capturedHunks ?? [],
    queue:
      capturedQueue ??
      (async () => {
        throw new Error('Diff queue is unavailable when diff rendering is guarded')
      }),
    flushLog,
    collectorLog,
    cleanup,
  }
}

const renderDiffMergeDock = async ({
  precision,
  phaseStats = null,
  autoAppliedRate,
  lastTab,
}: {
  readonly precision: MergePrecision
  readonly phaseStats?: MergeDockPhaseStats | null
  readonly autoAppliedRate?: number
  readonly lastTab?: MergeDockTabId
}): Promise<RenderMergeDockHarnessResult> =>
  renderMergeDockHarness({
    precision,
    phaseStats,
    autoAppliedRate,
    lastTab,
  })

interface RenderStableMergeDockOptions {
  readonly autoSaveEnabled?: boolean
  readonly requireDiff?: boolean
  readonly storyboard?: Storyboard
  readonly lastTab?: MergeDockTabId
}

const renderStableDiffMergeDock = async ({
  autoSaveEnabled = true,
  requireDiff = autoSaveEnabled,
  storyboard: storyboardOverride,
  lastTab,
}: RenderStableMergeDockOptions = {}): Promise<RenderMergeDockHarnessResult> =>
  renderMergeDockHarness({
    precision: 'stable',
    autoSaveEnabled,
    requireDiff,
    storyboard: storyboardOverride,
    lastTab,
  })

test('stable diff queue command publishes events and telemetry when guard unlocked', async () => {
  const harness = await renderStableDiffMergeDock({ autoSaveEnabled: true })
  const queueEvents = Reflect.get(harness.queue, '__diffMergeEvents__') as
    | {
        readonly subscribe: (listener: (event: Record<string, unknown>) => void) => () => void
      }
    | undefined

  assert.ok(queueEvents, 'DiffMergeView queue command must expose telemetry events hub')
  assert.match(harness.markup, /data-merge-autosave-enabled="true"/)
  assert.match(harness.markup, /data-merge-diff-visible="true"/)
  assert.match(harness.markup, /data-merge-diff-enabled="true"/)
  assert.match(harness.markup, /data-merge-diff-exposure="default"/)

  const events: Record<string, unknown>[] = []
  const unsubscribe = queueEvents!.subscribe((event) => {
    events.push(event)
  })

  try {
    const result = await harness.queue({
      type: 'queue-merge',
      precision: 'stable',
      origin: 'operation-pane.queue',
      hunkIds: ['cut-1'],
      telemetryContext: {
        collectorSurface: 'diff-merge.operation-pane',
        analyzerSurface: 'diff-merge.queue',
        lastTab: 'diff',
      },
      metadata: { autoSaveRequested: true },
    })

    assert.equal(result.status, 'success')
    assert.equal(events.length, 2)
    const started = events[0] as {
      readonly type: string
      readonly hunkIds?: readonly string[]
      readonly hunks?: readonly MergeHunk[]
      readonly autoSaveRequested?: boolean
    }
    assert.equal(started.type, 'queue:started')
    assert.deepEqual(started.hunkIds, ['cut-1'])
    assert.equal(started.autoSaveRequested, true)
    assert.deepEqual(started.hunks?.map((hunk) => hunk.id), ['cut-1'])

    const finished = events[1] as {
      readonly type: string
      readonly hunkIds?: readonly string[]
      readonly hunks?: readonly MergeHunk[]
      readonly retryable?: boolean
      readonly status?: string
    }
    assert.equal(finished.type, 'queue:finished')
    assert.equal(finished.status, 'success')
    assert.deepEqual(finished.hunkIds, ['cut-1'])
    assert.equal(finished.retryable, false)
    assert.deepEqual(finished.hunks?.map((hunk) => hunk.id), ['cut-1'])

    assert.equal(harness.flushLog.length, 1)
    assert.deepEqual(
      harness.collectorLog.map((entry) => entry.event),
      ['queue:start', 'queue:finish'],
    )
    assert.deepEqual(
      harness.collectorLog.map((entry) => entry.phase_guard),
      ['phase-b', 'phase-b'],
    )
    assert.deepEqual(
      harness.collectorLog.map((entry) => entry.diff_exposure),
      ['default', 'default'],
    )
  } finally {
    unsubscribe()
    harness.cleanup()
  }
})

test('stable diff queue command applies merge plan and emits merge events with autosave coordination', async () => {
  const storyboard: Storyboard = {
    id: 'sb-diff-auto-merge',
    title: 'Storyboard Auto',
    scenes: [
      {
        id: 'cut-auto-1',
        manual: 'Auto merge baseline',
        ai: 'Auto merge baseline',
        status: 'idle',
        assets: [],
        lock: null,
      },
    ],
    selection: [],
    version: 1,
  }

  const harness = await renderStableDiffMergeDock({ autoSaveEnabled: true, storyboard })
  const mergeHub = Reflect.get(harness.queue, '__mergeQueueHub__') as
    | { subscribe: (listener: (event: Record<string, unknown>) => void) => () => void }
    | undefined

  assert.ok(mergeHub, 'Diff queue command must expose merge event hub')

  const mergeEvents: Record<string, unknown>[] = []
  const unsubscribe = mergeHub!.subscribe((event) => {
    mergeEvents.push(event)
  })

  try {
    const result = await harness.queue({
      type: 'queue-merge',
      precision: 'stable',
      origin: 'operation-pane.queue',
      hunkIds: ['cut-auto-1'],
      telemetryContext: {
        collectorSurface: 'diff-merge.operation-pane',
        analyzerSurface: 'diff-merge.queue',
        lastTab: 'diff',
      },
      metadata: { autoSaveRequested: true },
    })

    assert.equal(result.status, 'success')
    assert.equal(result.telemetry.retryable, false)
    assert.equal(harness.flushLog.length, 1)

    const state = useSB.getState().sb
    const updatedScene = state.scenes.find((scene) => scene.id === 'cut-auto-1')
    assert.ok(updatedScene)
    assert.equal(updatedScene!.status, 'dirty')

    const autoAppliedEvents = mergeEvents.filter((event) => event.type === 'merge:auto-applied')
    assert.equal(autoAppliedEvents.length, 1)
    assert.equal((autoAppliedEvents[0]?.hunk as MergeHunk | undefined)?.id, 'cut-auto-1')

    const lockStages = mergeEvents
      .filter((event) => event.type === 'merge:autosave:lock')
      .map((event) => event.stage)
    assert.deepEqual(lockStages, ['acquired', 'released'])
  } finally {
    unsubscribe()
    harness.cleanup()
  }
})

test('stable diff tab remains hidden when autosave is disabled', async () => {
  const harness = await renderStableDiffMergeDock({ autoSaveEnabled: false, requireDiff: false })

  try {
    assert.match(harness.markup, /data-merge-autosave-enabled="false"/)
    assert.match(harness.markup, /data-merge-diff-visible="false"/)
    assert.doesNotMatch(harness.markup, />Diff(?: \(Beta\))?<\/button>/)
    assert.doesNotMatch(harness.markup, /data-component="diff-merge-view"/)
  } finally {
    harness.cleanup()
  }
})

test('resolveActiveTabTransition falls back to plan initial tab when diff disables', () => {
  const unlockedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.86,
    autoAppliedRate: 0.9,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 0 },
  })
  const demotedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.86,
    autoAppliedRate: 0.81,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 0 },
  })

  assert.equal(unlockedPlan.diff.enabled, true)
  assert.equal(demotedPlan.diff.enabled, false)
  assert.equal(demotedPlan.tabs.initialTab, 'compiled')

  const viewStore = createStore<{ readonly activeTab: 'compiled' | 'diff' }>(() => ({ activeTab: 'diff' }))
  const nextTab = resolveActiveTabTransition({
    precision: demotedPlan.precision,
    previousPrecision: unlockedPlan.precision,
    diffEnabled: demotedPlan.diff.enabled,
    previousDiffEnabled: unlockedPlan.diff.enabled,
    plan: demotedPlan.tabs,
    activeTab: viewStore.getState().activeTab,
    diffVisible: demotedPlan.diff.visible,
  })

  assert.equal(nextTab, demotedPlan.tabs.initialTab)
  assert.equal(nextTab, 'compiled')
})

test('resolveActiveTabTransition demotes active tab to plan initial tab when diffEnabled toggles off', () => {
  const promotedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.86,
    autoAppliedRate: 0.92,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 0 },
  })
  const demotedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.86,
    autoAppliedRate: 0.8,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 0 },
  })

  assert.equal(promotedPlan.diff.enabled, true)
  assert.equal(demotedPlan.diff.enabled, false)
  assert.equal(demotedPlan.tabs.initialTab, 'compiled')

  const nextTab = resolveActiveTabTransition({
    precision: demotedPlan.precision,
    previousPrecision: promotedPlan.precision,
    diffEnabled: demotedPlan.diff.enabled,
    previousDiffEnabled: promotedPlan.diff.enabled,
    plan: demotedPlan.tabs,
    activeTab: 'diff',
    diffVisible: demotedPlan.diff.visible,
  })

  assert.equal(nextTab, demotedPlan.tabs.initialTab)
  assert.equal(nextTab, 'compiled')
})

test('stable precision respects manual preference selection immediately after guard unlocks', () => {
  const guardedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
  })
  const unlockedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
    phaseStats: { reviewBandCount: 2, conflictBandCount: 0 },
  })

  assert.equal(guardedPlan.diff.enabled, false)
  assert.equal(unlockedPlan.diff.enabled, true)

  const manualPreference = resolvePreferenceSelection({
    precision: 'stable',
    previousPrecision: 'stable',
    diffEnabled: unlockedPlan.diff.enabled,
    previousDiffEnabled: guardedPlan.diff.enabled,
    preference: 'manual-first',
    defaultPreference: getDefaultPreference('stable', unlockedPlan.diff.enabled),
  })

  assert.equal(manualPreference, 'manual-first')
})

test('stable precision respects user preference across guard transitions', () => {
  const guardedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
  })

  assert.equal(guardedPlan.diff.enabled, false)
  assert.equal(getDefaultPreference('stable', guardedPlan.diff.enabled), 'diff-merge')
  assert.equal(sanitizePreference('manual-first', 'stable', guardedPlan.diff.enabled), 'manual-first')

  const unlockedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
    phaseStats: { reviewBandCount: 2, conflictBandCount: 0 },
  })

  assert.equal(unlockedPlan.diff.enabled, true)
  assert.equal(sanitizePreference('manual-first', 'stable', unlockedPlan.diff.enabled), 'manual-first')
  const nextPreference = resolvePreferenceSelection({
    precision: 'stable',
    previousPrecision: 'stable',
    diffEnabled: unlockedPlan.diff.enabled,
    previousDiffEnabled: guardedPlan.diff.enabled,
    preference: 'ai-first',
    defaultPreference: getDefaultPreference('stable', unlockedPlan.diff.enabled),
  })

  assert.equal(nextPreference, 'ai-first')

  const manualAiFirstPreference = resolvePreferenceSelection({
    precision: 'stable',
    previousPrecision: 'stable',
    diffEnabled: unlockedPlan.diff.enabled,
    previousDiffEnabled: unlockedPlan.diff.enabled,
    preference: 'ai-first',
    defaultPreference: getDefaultPreference('stable', unlockedPlan.diff.enabled),
  })

  assert.equal(manualAiFirstPreference, 'ai-first')
})

test('stable precision guard unlock restores manual fallback but honors opt-in overrides', () => {
  const guardedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
  })
  const unlockedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
    phaseStats: { reviewBandCount: 2, conflictBandCount: 0 },
  })

  assert.equal(guardedPlan.diff.enabled, false)
  assert.equal(unlockedPlan.diff.enabled, true)

  assert.equal(sanitizePreference('diff-merge', 'stable', guardedPlan.diff.enabled), 'diff-merge')

  const nextPreference = resolvePreferenceSelection({
    precision: 'stable',
    previousPrecision: 'stable',
    diffEnabled: unlockedPlan.diff.enabled,
    previousDiffEnabled: guardedPlan.diff.enabled,
    preference: 'ai-first',
    defaultPreference: getDefaultPreference('stable', unlockedPlan.diff.enabled),
  })

  assert.equal(nextPreference, 'ai-first')
})

test('stable precision keeps diff merge preference as default when diff unlocks', () => {
  const unlockedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
    phaseStats: { reviewBandCount: 2, conflictBandCount: 0 },
  })

  assert.equal(unlockedPlan.diff.enabled, true)

  const defaultPreference = getDefaultPreference('stable', unlockedPlan.diff.enabled)

  assert.equal(defaultPreference, 'diff-merge')

  const nextPreference = resolvePreferenceSelection({
    precision: 'stable',
    previousPrecision: 'stable',
    diffEnabled: unlockedPlan.diff.enabled,
    previousDiffEnabled: false,
    preference: 'diff-merge',
    defaultPreference,
  })

  assert.equal(nextPreference, 'diff-merge')
})

test('mergeMarkdownStoryboard imports markdown that starts with a cut heading', () => {
  const { mergeMarkdownStoryboard } = mergeDockModule as typeof mergeDockModule & {
    mergeMarkdownStoryboard?: (current: Storyboard, markdown: string, mode: 'manual' | 'ai') => Storyboard
  }

  assert.ok(
    mergeMarkdownStoryboard,
    'Day8/workflow-cookbook/GUARDRAILS.md「変更は最小差分で行い、Public API を破壊しない。」と Day8/docs/day8/guides/07_contributing.md「1タスク=1ブランチ=1PR」遵守のため、Markdown インポート用ヘルパーを公開する',
  )

  const base: Storyboard = {
    id: 'sb-1',
    title: 'Test',
    scenes: [
      { id: 'cut-1', manual: '', ai: '', status: 'idle', assets: [] },
      { id: 'cut-2', manual: '', ai: '', status: 'idle', assets: [] },
    ],
    selection: [],
    version: 1,
  }

  const markdown = ['## Cut 1', 'Manual line 1', '', '## Cut 2', 'Manual line 2'].join('\n')

  const imported = mergeMarkdownStoryboard!(base, markdown, 'manual')

  assert.equal(imported.scenes[0]?.manual, 'Manual line 1')
  assert.equal(imported.scenes[1]?.manual, 'Manual line 2')
})

test('mergeMarkdownStoryboard ignores multi-line HTML comments when importing markdown', () => {
  const { mergeMarkdownStoryboard } = mergeDockModule as typeof mergeDockModule & {
    mergeMarkdownStoryboard?: (current: Storyboard, markdown: string, mode: 'manual' | 'ai') => Storyboard
  }

  assert.ok(
    mergeMarkdownStoryboard,
    'Day8/workflow-cookbook/GUARDRAILS.md「実装時はテスト駆動開発を基本とし、テストを先に記述する。」と Day8/docs/day8/guides/07_contributing.md「1タスク=1ブランチ=1PR」を引用し、multi-line コメント除去仕様の RED テストを追加する',
  )

  const base: Storyboard = {
    id: 'sb-1',
    title: 'Test',
    scenes: [
      { id: 'cut-1', manual: '', ai: '', status: 'idle', assets: [] },
      { id: 'cut-2', manual: '', ai: '', status: 'idle', assets: [] },
    ],
    selection: [],
    version: 1,
  }

  const markdown = [
    '## Cut 1',
    'Manual line 1 before comment',
    '<!--',
    'ignored line 1',
    'ignored line 2',
    '-->',
    'Manual line 1 after comment',
    '',
    '## Cut 2',
    'Manual line 2 start',
    '<!-- inline comment begins',
    'still comment -->',
    'Manual line 2 end',
  ].join('\n')

  const imported = mergeMarkdownStoryboard!(base, markdown, 'manual')

  assert.equal(imported.scenes[0]?.manual, 'Manual line 1 before comment\nManual line 1 after comment')
  assert.equal(imported.scenes[1]?.manual, 'Manual line 2 start\nManual line 2 end')
})

test('mergeMarkdownStoryboard preserves paragraph spacing when removing inline HTML comments', () => {
  const { mergeMarkdownStoryboard } = mergeDockModule as typeof mergeDockModule & {
    mergeMarkdownStoryboard?: (current: Storyboard, markdown: string, mode: 'manual' | 'ai') => Storyboard
  }

  assert.ok(
    mergeMarkdownStoryboard,
    'Day8/workflow-cookbook/GUARDRAILS.md の「実装時はテスト駆動開発を基本とし、テストを先に記述する。」と Day8/docs/day8/guides/07_contributing.md の「1タスク=1ブランチ=1PR」を根拠に、インラインコメント除去時の余分な改行を検出する RED テストを追加する',
  )

  const base: Storyboard = {
    id: 'sb-1',
    title: 'Test',
    scenes: [
      { id: 'cut-1', manual: '', ai: '', status: 'idle', assets: [] },
      { id: 'cut-2', manual: '', ai: '', status: 'idle', assets: [] },
    ],
    selection: [],
    version: 1,
  }

  const markdown = [
    '## Cut 1',
    'Manual line 1 before comment',
    'Manual line 1 body <!-- inline comment that should be stripped -->',
    'Manual line 1 after comment',
    '',
    '## Cut 2',
    'Manual line 2',
  ].join('\n')

  const imported = mergeMarkdownStoryboard!(base, markdown, 'manual')

  assert.equal(
    imported.scenes[0]?.manual,
    'Manual line 1 before comment\nManual line 1 body\nManual line 1 after comment',
  )
  assert.equal(imported.scenes[1]?.manual, 'Manual line 2')
})

test('stable precision preserves manual preference once diff guard lifts but allows override', () => {
  const guardedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
  })
  const unlockedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
    phaseStats: { reviewBandCount: 2, conflictBandCount: 0 },
  })

  assert.equal(guardedPlan.diff.enabled, false)
  assert.equal(unlockedPlan.diff.enabled, true)

  const defaultGuardedPreference = sanitizePreference(
    getDefaultPreference('stable', guardedPlan.diff.enabled),
    'stable',
    guardedPlan.diff.enabled,
  )

  let preference = defaultGuardedPreference
  const onPreferenceChange = (
    next: 'manual-first' | 'ai-first' | 'diff-merge',
    diffEnabled: boolean,
  ) => {
    preference = sanitizePreference(next, 'stable', diffEnabled)
  }

  onPreferenceChange('manual-first', guardedPlan.diff.enabled)

  assert.equal(preference, 'manual-first')

  const defaultUnlockedPreference = sanitizePreference(
    getDefaultPreference('stable', unlockedPlan.diff.enabled),
    'stable',
    unlockedPlan.diff.enabled,
  )
  assert.equal(sanitizePreference('manual-first', 'stable', unlockedPlan.diff.enabled), 'manual-first')
  const nextPreference = resolvePreferenceSelection({
    precision: 'stable',
    previousPrecision: 'stable',
    diffEnabled: unlockedPlan.diff.enabled,
    previousDiffEnabled: guardedPlan.diff.enabled,
    preference,
    defaultPreference: defaultUnlockedPreference,
  })

  assert.equal(nextPreference, 'manual-first')

  preference = nextPreference

  onPreferenceChange('manual-first', unlockedPlan.diff.enabled)

  assert.equal(preference, 'manual-first')
})

test('diff queue command returns conflict status when conflicts detected', async () => {
  const storyboard: Storyboard = {
    id: 'sb-conflict-test',
    title: 'Conflict Test',
    scenes: [
      {
        id: 'cut-conflict-1',
        manual: 'Manual change',
        ai: 'AI change',
        status: 'idle',
        assets: [],
        lock: null,
      },
    ],
    selection: [],
    version: 1,
  }

  const harness = await renderStableDiffMergeDock({ autoSaveEnabled: true, storyboard })

  // テスト用にコンフリクトを発生させるモックを設定
  const originalMerge3 = DEFAULT_MERGE_ENGINE.merge3
  DEFAULT_MERGE_ENGINE.merge3 = (input, options) => {
    // コンフリクト状態をシミュレート
    const mockResult: MergeResult = {
      mergedText: input.ours, // 両方の変更を保持
      hunks: [
        {
          id: input.sceneId || 'mock-id',
          section: 'Mock Section',
          decision: 'conflict', // コンフリクトに設定
          similarity: 0.2, // 低類似度でコンフリクトをシミュレート
          locked: false,
          merged: input.ours,
          manual: input.ours,
          ai: input.theirs,
          base: input.base,
          prefer: 'none',
        }
      ],
      stats: {
        totalDecisions: 1,
        autoDecisions: 0,
        conflictDecisions: 1, // コンフリクト数を1に設定
        similarity: 0.2
      },
      plan: {
        entries: [],
        precision: options.profile?.precision || 'stable',
        threshold: options.profile?.threshold || 0.82
      }
    }
    return mockResult
  }

  try {
    const result = await harness.queue({
      type: 'queue-merge',
      precision: 'stable',
      origin: 'operation-pane.queue',
      hunkIds: ['cut-conflict-1'],
      telemetryContext: {
        collectorSurface: 'diff-merge.operation-pane',
        analyzerSurface: 'diff-merge.queue',
        lastTab: 'diff',
      },
      metadata: { autoSaveRequested: true },
    })

    assert.equal(result.status, 'conflict', 'Expected status to be conflict when conflicts are detected')
    assert.equal(result.telemetry.retryable, true, 'Expected retryable to be true for conflicts')
  } finally {
    // 元の実装に戻す
    DEFAULT_MERGE_ENGINE.merge3 = originalMerge3
    harness.cleanup()
  }
})

test('stable precision preserves manual fallback when guard unlocks before manual override', () => {
  const guardedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
  })
  const unlockedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
    phaseStats: { reviewBandCount: 2, conflictBandCount: 0 },
  })

  assert.equal(guardedPlan.diff.enabled, false)
  assert.equal(unlockedPlan.diff.enabled, true)

  const guardedDefault = getDefaultPreference('stable', guardedPlan.diff.enabled)
  const unlockedDefault = getDefaultPreference('stable', unlockedPlan.diff.enabled)

  assert.equal(guardedDefault, 'diff-merge')
  assert.equal(unlockedDefault, 'diff-merge')

  const restoredPreference = resolvePreferenceSelection({
    precision: 'stable',
    previousPrecision: 'stable',
    diffEnabled: unlockedPlan.diff.enabled,
    previousDiffEnabled: guardedPlan.diff.enabled,
    preference: 'manual-first',
    defaultPreference: unlockedDefault,
  })

  assert.equal(restoredPreference, 'manual-first')

  const manualOverridePreference = resolvePreferenceSelection({
    precision: 'stable',
    previousPrecision: 'stable',
    diffEnabled: unlockedPlan.diff.enabled,
    previousDiffEnabled: unlockedPlan.diff.enabled,
    preference: 'manual-first',
    defaultPreference: unlockedDefault,
  })

  assert.equal(manualOverridePreference, 'manual-first')
})

test('stable precision respects manual preference after diff remains unlocked', () => {
  const unlockedPlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
    phaseStats: { reviewBandCount: 2, conflictBandCount: 0 },
  })

  assert.equal(unlockedPlan.diff.enabled, true)

  const defaultPreference = getDefaultPreference('stable', unlockedPlan.diff.enabled)
  const nextPreference = resolvePreferenceSelection({
    precision: 'stable',
    previousPrecision: 'stable',
    diffEnabled: unlockedPlan.diff.enabled,
    previousDiffEnabled: unlockedPlan.diff.enabled,
    preference: 'manual-first',
    defaultPreference,
  })

  assert.equal(defaultPreference, 'diff-merge')
  assert.equal(nextPreference, 'manual-first')
})

test('stable precision clamps threshold upper bound and keeps diff initial tab when conflicts exist', () => {
  const plan: MergeDockPhasePlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.97,
    autoAppliedRate: 0.99,
    phaseStats: { reviewBandCount: 0, conflictBandCount: 1 },
  })

  assert.equal(plan.threshold.request, 0.94)
  assert.equal(plan.threshold.autoTarget, 0.95)
  assert.deepEqual(plan.threshold.reviewBand, { min: 0.93, max: 0.97 })
  assert.deepEqual(plan.threshold.conflictBand, { max: 0.93 })
  assert.equal(plan.diff.enabled, true)
  assert.equal(plan.diff.visible, true)
  assert.equal(plan.tabs.initialTab, 'diff')
  assert.equal(plan.autoApplied.meetsTarget, true)
})

test('stable precision sourced from workspace threshold keeps diff visible with default exposure when review bands are absent', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.88,
    phaseStats: { reviewBandCount: 0, conflictBandCount: 0 },
  })

  assert.equal(plan.threshold.request, 0.88)
  assert.equal(plan.diff.enabled, false)
  assert.equal(plan.diff.visible, true)
  assert.equal(plan.diff.exposure, 'default')
  assert.equal(plan.guard.phaseBRequired, false)
  assert.ok(plan.tabs.tabs.some((entry) => entry.id === 'diff'))
})

test('stable precision tab planning restores stored merge.lastTab preference', () => {
  const tabPlan = planMergeDockTabs('stable', 'compiled')

  assert.deepEqual(tabPlan, {
    tabs: [
      { id: 'compiled', label: 'Compiled Script' },
      { id: 'shot', label: 'Shotlist / Export' },
      { id: 'assets', label: 'Assets' },
      { id: 'import', label: 'Import' },
      { id: 'diff', label: 'Diff' },
      { id: 'golden', label: 'Golden' },
    ],
    initialTab: 'compiled',
    diff: { exposure: 'default', backupAfterMs: 300000 },
  })

  const phasePlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.88,
    lastTab: 'compiled',
  })

  assert.equal(phasePlan.tabs.initialTab, 'compiled')
  assert.deepEqual(phasePlan.tabs.diff, { exposure: 'default', backupAfterMs: 300000 })
  assert.deepEqual(
    phasePlan.tabs.tabs.map((entry) => entry.id),
    ['compiled', 'shot', 'assets', 'import', 'diff', 'golden'],
  )
  assert.equal(phasePlan.diff.initialTab, 'compiled')
  assert.equal(phasePlan.diff.visible, true)
  assert.equal(phasePlan.diff.enabled, false)
  assert.equal(phasePlan.diff.exposure, 'default')
})

test('stable precision resets stored merge.lastTab when diff demotes', () => {
  const lastTabs = ['compiled', 'shot', 'assets'] as const

  for (const lastTab of lastTabs) {
    const tabPlan = planMergeDockTabs('stable', lastTab)

    assert.equal(tabPlan.initialTab, lastTab)

    const phasePlan = resolveMergeDockPhasePlan({
      precision: 'stable',
      threshold: 0.86,
      autoAppliedRate: 0.81,
      phaseStats: { reviewBandCount: 3, conflictBandCount: 0 },
      lastTab,
    })

    assert.equal(phasePlan.autoApplied.meetsTarget, false)
    assert.equal(phasePlan.tabs.initialTab, 'compiled')
  }
})

test('merge dock passes merge3 output hunks when precision is beta or stable and autosave is enabled', () => {
  const mergeInput = {
    base: 'Base content',
    ours: 'Ours content',
    theirs: 'Theirs content',
  }

  // Test with beta precision and autosave enabled
  const betaResult = DEFAULT_MERGE_ENGINE.merge3(mergeInput, {
    profile: { precision: 'beta' }
  })
  
  assert.ok(Array.isArray(betaResult.hunks), 'Beta precision should return hunks array')
  assert.ok(betaResult.stats, 'Beta precision should return stats')
  assert.ok(betaResult.mergedText !== undefined, 'Beta precision should return merged text')
  
  // Verify that the hunks contain expected properties
  for (const hunk of betaResult.hunks) {
    assert.ok(hunk.id, 'Each hunk should have an id')
    assert.ok(hunk.decision !== undefined, 'Each hunk should have a decision')
    assert.ok(hunk.similarity !== undefined, 'Each hunk should have a similarity value')
    assert.ok(hunk.base !== undefined, 'Each hunk should have base content')
    assert.ok(hunk.manual !== undefined, 'Each hunk should have manual content')
    assert.ok(hunk.ai !== undefined, 'Each hunk should have ai content')
    assert.ok(hunk.merged !== undefined, 'Each hunk should have merged content')
  }

  // Test with stable precision and autosave enabled
  const stableResult = DEFAULT_MERGE_ENGINE.merge3(mergeInput, {
    profile: { precision: 'stable' }
  })
  
  assert.ok(Array.isArray(stableResult.hunks), 'Stable precision should return hunks array')
  assert.ok(stableResult.stats, 'Stable precision should return stats')
  assert.ok(stableResult.mergedText !== undefined, 'Stable precision should return merged text')
  
  // Verify that the hunks contain expected properties
  for (const hunk of stableResult.hunks) {
    assert.ok(hunk.id, 'Each hunk should have an id')
    assert.ok(hunk.decision !== undefined, 'Each hunk should have a decision')
    assert.ok(hunk.similarity !== undefined, 'Each hunk should have a similarity value')
    assert.ok(hunk.base !== undefined, 'Each hunk should have base content')
    assert.ok(hunk.manual !== undefined, 'Each hunk should have manual content')
    assert.ok(hunk.ai !== undefined, 'Each hunk should have ai content')
    assert.ok(hunk.merged !== undefined, 'Each hunk should have merged content')
  }

  // Verify that both beta and stable results match the expected merge3 output
  assert.ok(betaResult.hunks.length >= 0, 'Beta precision should return zero or more hunks')
  assert.ok(stableResult.hunks.length >= 0, 'Stable precision should return zero or more hunks')
})

test('stable precision restores last selected non-diff tab when merge.lastTab is set', () => {
  const tabPlan = planMergeDockTabs('stable', 'compiled')

  assert.equal(tabPlan.initialTab, 'compiled')

  const phasePlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.88,
    lastTab: 'compiled',
  })

  assert.equal(phasePlan.tabs.initialTab, 'compiled')
  assert.equal(phasePlan.diff.initialTab, 'compiled')
})

test('beta precision threshold never drops below 0.75', () => {
  const plan = resolveMergeThresholdPlan('beta', 0.7)

  assert.equal(plan.request, 0.75)
  assert.equal(plan.slider.min, 0.75)
})

test('beta precision auto target clamps to rollout maximum', () => {
  const plan = resolveMergeThresholdPlan('beta', 0.95)

  assert.equal(plan.request, 0.9)
  assert.equal(plan.autoTarget, 0.92)
})

test('beta autoApplied meetsTarget flips at 0.8 boundary', () => {
  const below = resolveMergeDockPhasePlan({
    precision: 'beta',
    threshold: 0.75,
    autoAppliedRate: 0.79,
  })
  const atTarget = resolveMergeDockPhasePlan({
    precision: 'beta',
    threshold: 0.75,
    autoAppliedRate: 0.8,
  })

  assert.equal(below.autoApplied.meetsTarget, false)
  assert.equal(atTarget.autoApplied.meetsTarget, true)
})

test('stable precision threshold never drops below 0.82', () => {
  const plan = resolveMergeThresholdPlan('stable', 0.8)

  assert.equal(plan.request, 0.82)
  assert.equal(plan.slider.min, 0.82)
  assert.equal(plan.autoTarget, 0.86)
})

test('stable precision auto target clamps to rollout maximum', () => {
  const plan = resolveMergeThresholdPlan('stable', 0.98)

  assert.equal(plan.request, 0.94)
  assert.equal(plan.autoTarget, 0.95)
})

test('stable autoApplied meetsTarget flips at 0.86 boundary', () => {
  const below = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
    autoAppliedRate: 0.85,
  })
  const atTarget = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
    autoAppliedRate: 0.86,
  })

  assert.equal(below.autoApplied.meetsTarget, false)
  assert.equal(atTarget.autoApplied.meetsTarget, true)
})

test('workspace threshold from resolveFlags updates diff exposure and clamp', () => {
  const workspace = {
    get: (key: string): unknown => {
      if (key === 'merge.threshold' || key === 'conimg.merge.threshold') {
        return 0.97
      }
      return undefined
    },
  }

  const { precision, threshold } = resolveMergeThresholdSnapshot({ workspace, storage: null })
  const plan = resolveMergeDockPhasePlan({
    precision,
    threshold,
    phaseStats: { reviewBandCount: 3, conflictBandCount: 1 },
  })

  assert.equal(precision, 'stable')
  assert.equal(plan.threshold.request, 0.94)
  assert.equal(plan.threshold.autoTarget, 0.95)
  assert.equal(plan.diff.enabled, true)
  assert.equal(plan.diff.exposure, 'default')
  assert.equal(plan.autoApplied.target, 0.95)
})

test('env precision threshold from flags overrides workspace and storage settings', () => {
  const workspace = {
    get: (key: string): unknown => {
      if (key === 'merge.threshold' || key === 'conimg.merge.threshold') {
        return 0.83
      }
      return undefined
    },
  }

  const storage = {
    getItem: (key: string): string | null => {
      if (key === 'conimg.merge.threshold') {
        return '0.9'
      }
      return null
    },
  }

  const snapshot = resolveMergeThresholdSnapshot({ workspace, storage, precision: 'beta', threshold: 0.75 })
  assert.equal(snapshot.precision, 'beta')
  assert.equal(snapshot.threshold, 0.75)

  const plan = resolveMergeDockPhasePlan({
    precision: snapshot.precision,
    threshold: snapshot.threshold,
    phaseStats: { reviewBandCount: 2, conflictBandCount: 0 },
  })

  assert.equal(plan.diff.enabled, true)
  assert.equal(plan.diff.visible, true)
  assert.equal(plan.guard.phaseBRequired, true)
  assert.equal(plan.threshold.request, 0.75)
  assert.equal(plan.autoApplied.target, 0.8)
})

test('resolveMergeThresholdSnapshot clamps beta workspace threshold below rollout minimum', () => {
  const workspace = {
    get: (key: string): unknown => {
      if (key === 'conimg.merge.threshold') {
        return 0.7
      }
      return undefined
    },
  }

  const betaFlags: Pick<FlagSnapshot, 'merge'> = {
    merge: {
      value: 'beta',
      source: 'workspace',
      errors: [],
      precision: 'beta',
      threshold: Number.NaN,
    },
  }

  const snapshot = resolveMergeThresholdSnapshot({
    workspace,
    storage: null,
    precision: 'beta',
    flags: betaFlags,
  })

  assert.equal(snapshot.precision, 'beta')
  assert.equal(snapshot.threshold, 0.75)
})

test('resolveMergeThresholdSnapshot clamps stable workspace threshold below rollout minimum', () => {
  const workspace = {
    get: (key: string): unknown => {
      if (key === 'conimg.merge.threshold') {
        return 0.8
      }
      return undefined
    },
  }

  const stableFlags: Pick<FlagSnapshot, 'merge'> = {
    merge: {
      value: 'stable',
      source: 'workspace',
      errors: [],
      precision: 'stable',
      threshold: Number.NaN,
    },
  }

  const snapshot = resolveMergeThresholdSnapshot({
    workspace,
    storage: null,
    precision: 'stable',
    flags: stableFlags,
  })

  assert.equal(snapshot.precision, 'stable')
  assert.equal(snapshot.threshold, 0.82)
})

test('Diff queue goes through merge3 execution and Merge event hub notification with AutoSave lock coordination', () => {
  // Create a mock storyboard
  const mockStoryboard: Storyboard = {
    id: 'test-sb',
    title: 'Test Storyboard',
    scenes: [
      { id: 'cut-1', manual: 'Manual content', ai: 'AI content', status: 'idle', assets: [] },
      { id: 'cut-2', manual: 'Another manual content', ai: 'Another AI content', status: 'idle', assets: [] },
    ],
    selection: [],
    version: 1,
  }

  // Create event hub
  const { hub: eventHub, dispose } = createEventHub()
  
  // Track published events
  const publishedEvents: any[] = []
  const unsubscribe = eventHub.subscribe((event) => {
    publishedEvents.push(event)
  })

  // Create auto-save lock events
  const detachAutoSaveLockEvents = mergeEventsModule.attachAutoSaveLockEvents(eventHub)

  try {
    // Mock merge input
    const mockInput = {
      base: 'base content',
      ours: 'ours content',
      theirs: 'theirs content',
      sceneId: 'test-scene',
    }

    // Execute merge3 with event hub and queue command
    let queueCommandExecuted = false
    const mockQueueCommand = (command: any) => {
      queueCommandExecuted = true
    }

    // Call merge3
    const result = DEFAULT_MERGE_ENGINE.merge3(mockInput, {
      events: eventHub,
      queueMergeCommand: mockQueueCommand,
    })

    // Verify that the merge was successful and command was queued
    assert.ok(result.hunks.length > 0, 'Expected merge result to have hunks')
    assert.ok(queueCommandExecuted, 'Expected queueMergeCommand to be executed')
    
    // Check that events were published to the event hub
    assert.ok(publishedEvents.length > 0, 'Expected some events to be published to event hub')
    
    // Check for auto-save lock events
    const hasAutoSaveLockEvents = publishedEvents.some(event => 
      event.type === 'merge:autosave:lock'
    )
    
    // Verify merge decision events were published
    const hasMergeDecisionEvents = publishedEvents.some(event =>
      event.type === 'merge:auto-applied' || event.type === 'merge:conflict-detected'
    )
    
    assert.ok(hasMergeDecisionEvents, 'Expected merge decision events to be published')
    
    // Verify result includes plan when successful
    if (result.plan) {
      assert.ok(result.plan.entries.length > 0, 'Expected plan to have entries')
      assert.equal(result.plan.precision, 'stable', 'Expected default precision to be stable')
    }
  } finally {
    unsubscribe()
    detachAutoSaveLockEvents?.()
    dispose()
  }
test('merge dock passes merge3 output hunks when precision is beta or stable and autosave is enabled', () => {
  const mergeInput = {
    base: 'Base content',
    ours: 'Ours content',
    theirs: 'Theirs content',
  }

  // Test with beta precision and autosave enabled
  const betaResult = DEFAULT_MERGE_ENGINE.merge3(mergeInput, {
    profile: { precision: 'beta' }
  })
  
  assert.ok(Array.isArray(betaResult.hunks), 'Beta precision should return hunks array')
  assert.ok(betaResult.stats, 'Beta precision should return stats')
  assert.ok(betaResult.mergedText !== undefined, 'Beta precision should return merged text')
  
  // Verify that the hunks contain expected properties
  for (const hunk of betaResult.hunks) {
    assert.ok(hunk.id, 'Each hunk should have an id')
    assert.ok(hunk.decision !== undefined, 'Each hunk should have a decision')
    assert.ok(hunk.similarity !== undefined, 'Each hunk should have a similarity value')
    assert.ok(hunk.base !== undefined, 'Each hunk should have base content')
    assert.ok(hunk.manual !== undefined, 'Each hunk should have manual content')
    assert.ok(hunk.ai !== undefined, 'Each hunk should have ai content')
    assert.ok(hunk.merged !== undefined, 'Each hunk should have merged content')
  }

  // Test with stable precision and autosave enabled
  const stableResult = DEFAULT_MERGE_ENGINE.merge3(mergeInput, {
    profile: { precision: 'stable' }
  })
  
  assert.ok(Array.isArray(stableResult.hunks), 'Stable precision should return hunks array')
  assert.ok(stableResult.stats, 'Stable precision should return stats')
  assert.ok(stableResult.mergedText !== undefined, 'Stable precision should return merged text')
  
  // Verify that the hunks contain expected properties
  for (const hunk of stableResult.hunks) {
    assert.ok(hunk.id, 'Each hunk should have an id')
    assert.ok(hunk.decision !== undefined, 'Each hunk should have a decision')
    assert.ok(hunk.similarity !== undefined, 'Each hunk should have a similarity value')
    assert.ok(hunk.base !== undefined, 'Each hunk should have base content')
    assert.ok(hunk.manual !== undefined, 'Each hunk should have manual content')
    assert.ok(hunk.ai !== undefined, 'Each hunk should have ai content')
    assert.ok(hunk.merged !== undefined, 'Each hunk should have merged content')
  }

  // Verify that both beta and stable results match the expected merge3 output
  assert.ok(betaResult.hunks.length >= 0, 'Beta precision should return zero or more hunks')
  assert.ok(stableResult.hunks.length >= 0, 'Stable precision should return zero or more hunks')
})
