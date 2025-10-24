import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  planAutoSave,
  publishAutoSaveGuard,
  type AutoSaveActivationDecision
} from '../../src/App'
import {
  DEFAULT_FLAG_SNAPSHOT,
  type AutoSaveBootstrapPlan
} from '../../src/config'

type PlanOptions = {
  readonly featureEnabled: boolean
  readonly optionsDisabled: boolean
}

function createPlan(options: PlanOptions): AutoSaveBootstrapPlan {
  const { featureEnabled, optionsDisabled } = options
  return {
    snapshot: {
      ...DEFAULT_FLAG_SNAPSHOT,
      autosave: {
        ...DEFAULT_FLAG_SNAPSHOT.autosave,
        value: featureEnabled,
        enabled: featureEnabled,
        source: featureEnabled ? 'workspace' : 'default',
        errors: []
      }
    },
    guard: {
      featureFlag: {
        value: featureEnabled,
        source: featureEnabled ? 'workspace' : 'default'
      },
      optionsDisabled
    },
    failSafePhase: 'phase-a0'
  }
}

test('planAutoSave returns manual-only decision when optionsDisabled=true', () => {
  const plan = createPlan({ featureEnabled: true, optionsDisabled: true })

  const decision = planAutoSave(plan)

  assert.equal(decision.mode, 'manual-only')
  assert.equal(decision.reason, 'options-disabled')
  assert.equal(decision.guard.optionsDisabled, true)
})

test('publishAutoSaveGuard forwards manual-only reason to Day8 collector hook', () => {
  const emitted: unknown[] = []
  const originalCollector = (globalThis as { Day8Collector?: unknown }).Day8Collector
  ;(globalThis as { Day8Collector?: { publish: (event: unknown) => void } }).Day8Collector = {
    publish(event) {
      emitted.push(event)
    }
  }

  try {
    const decision: AutoSaveActivationDecision = {
      mode: 'manual-only',
      reason: 'feature-flag-disabled',
      guard: {
        featureFlag: { value: false, source: 'workspace' },
        optionsDisabled: false
      }
    }

    publishAutoSaveGuard(decision)

    assert.equal(emitted.length, 1)
    const event = emitted[0] as Record<string, unknown>
    assert.equal(event?.feature, 'autosave-diff-merge')
    assert.equal(event?.event, 'autosave.guard')
    assert.equal(event?.blocked, true)
    assert.equal(event?.reason, 'feature-flag-disabled')
    assert.deepEqual(event?.guard, decision.guard)
    assert.match(String(event?.ts ?? ''), /^\d{4}-\d{2}-\d{2}T/)
  } finally {
    if (originalCollector) {
      (globalThis as { Day8Collector?: unknown }).Day8Collector = originalCollector
    } else {
      delete (globalThis as { Day8Collector?: unknown }).Day8Collector
    }
  }
})

test('publishAutoSaveGuard distinguishes options-disabled reason in Day8 collector hook', () => {
  const emitted: unknown[] = []
  const originalCollector = (globalThis as { Day8Collector?: unknown }).Day8Collector
  ;(globalThis as { Day8Collector?: { publish: (event: unknown) => void } }).Day8Collector = {
    publish(event) {
      emitted.push(event)
    }
  }

  try {
    const decision: AutoSaveActivationDecision = {
      mode: 'manual-only',
      reason: 'options-disabled',
      guard: {
        featureFlag: { value: true, source: 'workspace' },
        optionsDisabled: true
      }
    }

    publishAutoSaveGuard(decision)

    assert.equal(emitted.length, 1)
    const event = emitted[0] as Record<string, unknown>
    assert.equal(event?.reason, 'options-disabled')
    assert.deepEqual(event?.guard, decision.guard)
  } finally {
    if (originalCollector) {
      (globalThis as { Day8Collector?: unknown }).Day8Collector = originalCollector
    } else {
      delete (globalThis as { Day8Collector?: unknown }).Day8Collector
    }
  }
})
