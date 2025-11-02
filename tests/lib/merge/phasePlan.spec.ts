import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveMergeDockPhasePlan,
  resolveMergeThresholdPlan,
  shouldShowDiffBackupCTA,
} from '../../../src/lib/merge/phasePlan.ts'

test('phasePlan: stable precision threshold plan clamps defaults', () => {
  const plan = resolveMergeThresholdPlan('stable', undefined)

  assert.equal(plan.precision, 'stable')
  assert.equal(plan.request, 0.82)
  assert.deepEqual(plan.slider, { min: 0.82, max: 0.94, step: 0.01, defaultValue: 0.82 })
  assert.equal(plan.autoTarget, 0.86)
  assert.deepEqual(plan.reviewBand, { min: 0.81, max: 0.85 })
  assert.deepEqual(plan.conflictBand, { max: 0.81 })
})

test('phasePlan: stable diff demotes to compiled when review signals exist and target unmet', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.82,
    lastTab: 'diff',
    autoAppliedRate: 0.8,
    phaseStats: { reviewBandCount: 2, conflictBandCount: 0 },
  })

  assert.equal(plan.tabs.initialTab, 'compiled')
  assert.equal(plan.diff.initialTab, 'compiled')
  assert.equal(plan.diff.exposure, 'opt-in')
  assert.equal(plan.diff.visible, true)
  assert.equal(plan.diff.enabled, false)
  assert.deepEqual(plan.tabs.diff, { exposure: 'opt-in' })
  assert.deepEqual(plan.autoApplied, { rate: 0.8, target: 0.86, meetsTarget: false })
  assert.deepEqual(plan.guard, { phaseBRequired: true, reviewBandCount: 2, conflictBandCount: 0 })
})

test('phasePlan: stable diff exposure demotes when auto rate falls below target without stats', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.86,
    autoAppliedRate: 0.8,
    phaseStats: null,
  })

  assert.equal(plan.tabs.initialTab, 'compiled')
  assert.equal(plan.diff.initialTab, 'compiled')
  assert.equal(plan.diff.exposure, 'opt-in')
  assert.equal(plan.diff.visible, true)
  assert.equal(plan.diff.enabled, false)
})

test('phasePlan: diff backup CTA only shows when threshold elapsed', () => {
  const policy = { enabledPrecisions: ['beta', 'stable'], gateTab: 'diff', thresholdMs: 5 * 60 * 1000 }
  const now = Date.parse('2024-01-02T00:05:01.000Z')

  assert.equal(
    shouldShowDiffBackupCTA(policy, 'stable', 'diff', '2024-01-02T00:00:00.000Z', now),
    true,
  )
  assert.equal(
    shouldShowDiffBackupCTA(policy, 'stable', 'diff', '2024-01-02T00:02:30.000Z', now),
    false,
  )
  assert.equal(
    shouldShowDiffBackupCTA(policy, 'legacy', 'diff', '2024-01-02T00:00:00.000Z', now),
    false,
  )
  assert.equal(shouldShowDiffBackupCTA(policy, 'stable', 'diff', undefined, now), false)
})
