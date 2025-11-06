import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  DEFAULT_FLAG_SNAPSHOT,
  FLAG_MIGRATION_PLAN,
  resolveAutoSaveBootstrapPlan,
  type AutoSaveBootstrapPlan,
  type ResolveOptions
} from '../../src/config'
import { AUTOSAVE_POLICY } from '../../src/lib/autosave'
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
    failSafePhase: 'phase-a0',
    policy: AUTOSAVE_POLICY
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

test('planAutoSave returns feature-flag-disabled reason when flag is disabled via env', () => {
  const env = { VITE_AUTOSAVE_ENABLED: 'false' }
  const options: ResolveOptions = { env }
  const plan = resolveAutoSaveBootstrapPlan(options)
  const decision = planAutoSave(plan)

  assert.equal(decision.mode, 'manual-only')
  assert.equal(decision.reason, 'feature-flag-disabled')
})

test('planAutoSave returns feature-flag-disabled reason when flag is disabled via workspace', () => {
  const workspace = { get: (key: string) => key === 'conimg.autosave.enabled' ? false : undefined }
  const options: ResolveOptions = { workspace }
  const plan = resolveAutoSaveBootstrapPlan(options)
  const decision = planAutoSave(plan)

  assert.equal(decision.mode, 'manual-only')
  assert.equal(decision.reason, 'feature-flag-disabled')
})
