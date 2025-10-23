import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  DEFAULT_FLAG_SNAPSHOT,
  FLAG_MIGRATION_PLAN,
  resolveAutoSaveBootstrapPlan,
  type AutoSaveBootstrapPlan
} from '../../src/config'
import { planAutoSave } from '../../src/App'

function createPlan(enabled: boolean): AutoSaveBootstrapPlan {
  return {
    snapshot: {
      ...DEFAULT_FLAG_SNAPSHOT,
      autosave: {
        ...DEFAULT_FLAG_SNAPSHOT.autosave,
        value: enabled,
        enabled,
        source: enabled ? 'workspace' : 'default',
        errors: []
      }
    },
    guard: {
      featureFlag: { value: enabled, source: enabled ? 'workspace' : 'default' },
      optionsDisabled: false
    },
    failSafePhase: 'phase-a0'
  }
}

test('planAutoSave keeps manual shortcuts when autosave flag disabled', () => {
  const decision = planAutoSave(createPlan(false))

  assert.equal(decision.mode, 'manual-only')
  assert.equal(decision.reason, 'phase-a0-failsafe')
})

test('planAutoSave allows initAutoSave when autosave flag enabled', () => {
  const decision = planAutoSave(createPlan(true))

  assert.equal(decision.mode, 'autosave')
  assert.equal(decision.reason, 'feature-flag-enabled')
})

test('resolveAutoSaveBootstrapPlan carries phase-a0 fail-safe metadata', () => {
  const plan = resolveAutoSaveBootstrapPlan()
  const phaseA0 = FLAG_MIGRATION_PLAN.find((step) => step.phase === 'phase-a0')

  assert.equal(plan.failSafePhase, phaseA0?.phase ?? null)
})
