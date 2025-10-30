/// <reference types="node" />

const tsNodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
if (tsNodeEnv) {
  tsNodeEnv.TS_NODE_IGNORE_DIAGNOSTICS = '2304,2307,2578,2580,5097'
}

import assert from 'node:assert/strict'
import test from 'node:test'

import { diffBackupPolicy, resolveMergeDockPhasePlan } from '../../src/lib/merge/phasePlan.ts'
import {
  isDiffBackupCTAEligible,
  shouldEnableDiffInteraction,
  shouldRenderDiffBackupCTA,
} from '../../src/lib/merge/diffBackup.ts'

test('isDiffBackupCTAEligible returns true when diff plan is enabled for non-legacy precision', () => {
  const phasePlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: null,
    lastTab: 'diff',
    autoAppliedRate: null,
    phaseStats: { reviewBandCount: 1, conflictBandCount: 0 },
  })

  assert.equal(phasePlan.diff.enabled, true)
  assert.equal(isDiffBackupCTAEligible(phasePlan.diff, 'stable'), true)
})

test('shouldRenderDiffBackupCTA returns false without flush callback', () => {
  const phasePlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: null,
    lastTab: 'diff',
    autoAppliedRate: null,
    phaseStats: { reviewBandCount: 1, conflictBandCount: 0 },
  })

  const now = Date.UTC(2024, 0, 1, 0, 10, 0)
  const result = shouldRenderDiffBackupCTA({
    diffPlan: phasePlan.diff,
    tabPlan: phasePlan.tabs,
    policy: diffBackupPolicy,
    precision: 'stable',
    activeTab: 'diff',
    autoSave: { flushNow: undefined, lastSuccessAt: new Date(now - 10 * 60 * 1000).toISOString() },
    now,
  })

  assert.equal(result, false)
})

test('shouldRenderDiffBackupCTA respects tab-level threshold override when flush callback is available', () => {
  const phasePlan = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: null,
    lastTab: 'diff',
    autoAppliedRate: null,
    phaseStats: { reviewBandCount: 1, conflictBandCount: 0 },
  })

  const now = Date.UTC(2024, 0, 1, 0, 10, 0)
  const result = shouldRenderDiffBackupCTA({
    diffPlan: phasePlan.diff,
    tabPlan: phasePlan.tabs,
    policy: diffBackupPolicy,
    precision: 'stable',
    activeTab: 'diff',
    autoSave: {
      flushNow: () => {},
      lastSuccessAt: new Date(now - (phasePlan.tabs.diff?.backupAfterMs ?? 0) - 1).toISOString(),
    },
    now,
  })

  assert.equal(result, true)
})

test('shouldEnableDiffInteraction mirrors diff visibility, enablement, and guard requirement', () => {
  const withoutSignals = resolveMergeDockPhasePlan({
    precision: 'beta',
    threshold: null,
    lastTab: 'diff',
    autoAppliedRate: null,
    phaseStats: null,
  })
  const withSignals = resolveMergeDockPhasePlan({
    precision: 'stable',
    threshold: null,
    lastTab: 'diff',
    autoAppliedRate: null,
    phaseStats: { reviewBandCount: 1, conflictBandCount: 0 },
  })

  assert.equal(shouldEnableDiffInteraction({ diffPlan: withoutSignals.diff, guard: withoutSignals.guard }), false)
  assert.equal(shouldEnableDiffInteraction({ diffPlan: withSignals.diff, guard: withSignals.guard }), true)
})
