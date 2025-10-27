import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_FLAGS, type FlagSnapshot } from '../../src/config'
import {
  resolveMergeDockPhasePlan,
  resolveMergeThresholdPlan,
  resolveMergeThresholdSnapshot,
  type MergeDockPhasePlan,
  diffBackupPolicy,
  shouldRenderDiffBackupCTA,
  shouldShowDiffBackupCTA,
  isDiffBackupCTAEligible,
} from '../../src/components/MergeDock.tsx'

test('resolveMergeThresholdSnapshot falls back to default threshold', () => {
  const snapshot = resolveMergeThresholdSnapshot({ workspace: null, storage: null })

  assert.equal(snapshot.threshold, DEFAULT_FLAGS.merge.profile.threshold)
  assert.equal(DEFAULT_FLAGS.merge.profile.threshold, 0.75)
  assert.equal(snapshot.precision, 'legacy')
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

test('beta precision without phase stats keeps diff visible but guarded', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'beta',
    threshold: 0.7,
  })

  assert.equal(plan.diff.enabled, false)
  assert.equal(plan.diff.visible, true)
  assert.equal(plan.diff.exposure, 'opt-in')
  assert.equal(plan.guard.phaseBRequired, false)
  assert.deepEqual(
    plan.tabs.tabs.map((entry) => entry.id),
    ['compiled', 'shot', 'assets', 'import', 'golden', 'diff'],
  )
})

test('beta precision suppresses diff tab when review band is empty', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'beta',
    threshold: 0.85,
    autoAppliedRate: 0.75,
    phaseStats: { reviewBandCount: 0, conflictBandCount: 0 },
  })

  assert.equal(plan.diff.enabled, false)
  assert.equal(plan.diff.visible, true)
  assert.equal(plan.guard.phaseBRequired, false)
  assert.deepEqual(
    plan.tabs.tabs.map((entry) => entry.id),
    ['compiled', 'shot', 'assets', 'import', 'golden', 'diff'],
  )
  assert.equal(plan.threshold.request, 0.85)
  assert.equal(plan.threshold.autoTarget, 0.9)
  assert.equal(plan.autoApplied.rate, 0.75)
  assert.equal(plan.autoApplied.meetsTarget, false)
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

test('stable precision without phase stats keeps diff visible and gated', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
  })

  assert.equal(plan.diff.enabled, false)
  assert.equal(plan.diff.visible, true)
  assert.equal(plan.diff.exposure, 'default')
  assert.equal(plan.guard.phaseBRequired, false)
  assert.deepEqual(
    plan.tabs.tabs.map((entry) => entry.id),
    ['compiled', 'shot', 'assets', 'import', 'diff', 'golden'],
  )
  assert.equal(plan.tabs.initialTab, 'diff')
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

test('stable precision sourced from workspace threshold stays opt-in without review bands', () => {
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
})

test('stable precision auto target clamps to rollout maximum', () => {
  const plan = resolveMergeThresholdPlan('stable', 0.98)

  assert.equal(plan.request, 0.94)
  assert.equal(plan.autoTarget, 0.95)
})

test('stable autoApplied meetsTarget flips at 0.91 boundary', () => {
  const below = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.88,
    autoAppliedRate: 0.9,
  })
  const atTarget = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.88,
    autoAppliedRate: 0.91,
  })

  assert.equal(below.autoApplied.meetsTarget, false)
  assert.equal(atTarget.autoApplied.meetsTarget, true)
})

test('workspace threshold from resolveFlags updates diff exposure and clamp', () => {
  const workspace = {
    get: (key: string): unknown => {
      if (key === 'conimg.merge.threshold') {
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
      if (key === 'conimg.merge.threshold') {
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
