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
import { createStore } from 'zustand/vanilla'

import { DEFAULT_FLAGS, type FlagSnapshot } from '../../src/config'
const mergeDockModule = await import('../../src/components/MergeDock')
const {
  resolveMergeDockPhasePlan,
  planMergeDockTabs,
  resolveMergeThresholdPlan,
  resolveMergeThresholdSnapshot,
  diffBackupPolicy,
  shouldRenderDiffBackupCTA,
  shouldShowDiffBackupCTA,
  isDiffBackupCTAEligible,
  getDefaultPreference,
  sanitizePreference,
  resolvePreferenceSelection,
  resolveActiveTabTransition,
  shouldEnableDiffInteraction,
  sanitizeMergeDockActiveTab,
} = mergeDockModule as typeof mergeDockModule & {
  readonly getDefaultPreference: (
    precision: FlagSnapshot['merge']['precision'],
    diffEnabled: boolean,
  ) => 'manual-first' | 'ai-first' | 'diff-merge'
  readonly sanitizePreference: (
    preference: 'manual-first' | 'ai-first' | 'diff-merge',
    precision: FlagSnapshot['merge']['precision'],
    diffEnabled: boolean,
  ) => 'manual-first' | 'ai-first' | 'diff-merge'
  readonly resolvePreferenceSelection: (input: {
    readonly precision: FlagSnapshot['merge']['precision']
    readonly previousPrecision: FlagSnapshot['merge']['precision']
    readonly diffEnabled: boolean
    readonly previousDiffEnabled: boolean
    readonly preference: 'manual-first' | 'ai-first' | 'diff-merge'
    readonly defaultPreference: 'manual-first' | 'ai-first' | 'diff-merge'
  }) => 'manual-first' | 'ai-first' | 'diff-merge'
  readonly resolveActiveTabTransition: (input: {
    readonly precision: FlagSnapshot['merge']['precision']
    readonly previousPrecision: FlagSnapshot['merge']['precision']
    readonly diffEnabled: boolean
    readonly previousDiffEnabled: boolean
    readonly plan: ReturnType<typeof resolveMergeDockPhasePlan>['tabs']
    readonly activeTab: ReturnType<typeof resolveMergeDockPhasePlan>['tabs']['initialTab']
    readonly diffVisible: boolean
  }) => ReturnType<typeof resolveMergeDockPhasePlan>['tabs']['initialTab']
  readonly shouldEnableDiffInteraction: (input: {
    readonly diffPlan: MergeDockPhasePlan['diff']
    readonly guard: MergeDockPhasePlan['guard']
  }) => boolean
  readonly sanitizeMergeDockActiveTab: (
    tab: MergeDockPhasePlan['tabs']['initialTab'],
    plan: MergeDockPhasePlan['tabs'],
    diffVisible: boolean,
    diffEnabled: boolean,
  ) => MergeDockPhasePlan['tabs']['initialTab']
}
type MergeDockPhasePlan = ReturnType<typeof resolveMergeDockPhasePlan>

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
    ['compiled', 'shot', 'assets', 'import', 'diff', 'golden'],
  )
  assert.equal(plan.tabs.initialTab, 'compiled')
  assert.equal(plan.diff.visible, true)
  assert.equal(plan.diff.exposure, 'opt-in')
  assert.equal(plan.diff.enabled, false)
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
