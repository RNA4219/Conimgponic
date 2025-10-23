import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveMergeDockPhasePlan,
  type MergeDockPhasePlan,
} from '../../src/components/MergeDock.tsx'

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
  assert.equal(plan.diff.exposure, 'opt-in')
  assert.ok(plan.tabs.tabs.some((entry) => entry.id === 'diff'))
  assert.equal(plan.threshold.request, 0.7)
  assert.equal(plan.threshold.autoTarget, 0.75)
  assert.deepEqual(plan.threshold.reviewBand, { min: 0.68, max: 0.75 })
  assert.deepEqual(plan.threshold.conflictBand, { max: 0.68 })
  assert.equal(plan.guard.phaseBRequired, true)
})

test('beta precision suppresses diff tab when review band is empty', () => {
  const plan = resolveMergeDockPhasePlan({
    precision: 'beta',
    threshold: 0.85,
    autoAppliedRate: 0.72,
    phaseStats: { reviewBandCount: 0, conflictBandCount: 0 },
  })

  assert.equal(plan.diff.enabled, false)
  assert.equal(plan.guard.phaseBRequired, false)
  assert.deepEqual(
    plan.tabs.tabs.map((entry) => entry.id),
    ['compiled', 'shot', 'assets', 'import', 'golden'],
  )
  assert.equal(plan.threshold.request, 0.85)
  assert.equal(plan.threshold.autoTarget, 0.9)
  assert.equal(plan.autoApplied.rate, 0.72)
  assert.equal(plan.autoApplied.meetsTarget, false)
})

test('stable precision clamps threshold upper bound and keeps diff initial tab when conflicts exist', () => {
  const plan: MergeDockPhasePlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: 0.97,
    autoAppliedRate: 0.99,
    phaseStats: { reviewBandCount: 0, conflictBandCount: 1 },
  })

  assert.equal(plan.threshold.request, 0.94)
  assert.equal(plan.threshold.autoTarget, 0.97)
  assert.deepEqual(plan.threshold.reviewBand, { min: 0.93, max: 0.97 })
  assert.deepEqual(plan.threshold.conflictBand, { max: 0.93 })
  assert.equal(plan.diff.enabled, true)
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
  assert.equal(plan.diff.exposure, 'opt-in')
  assert.equal(plan.guard.phaseBRequired, false)
})
