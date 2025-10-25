import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveAutoSaveBootstrapPlan,
  resolvePluginBridgeBootstrapPlan,
  type FlagSnapshot,
  type FlagValidationError,
  type ResolveOptions
} from '../../src/config'

test('resolveAutoSaveBootstrapPlan publishes flag resolution telemetry with errors', () => {
  const emitted: unknown[] = []
  const scope = globalThis as { Day8Collector?: { publish: (event: unknown) => void } }
  const original = scope.Day8Collector
  scope.Day8Collector = {
    publish(event) {
      emitted.push(event)
    }
  }

  try {
    const resolveOptions: ResolveOptions = {
      env: {
        VITE_AUTOSAVE_ENABLED: 'definitely-not-boolean'
      }
    }

    const plan = resolveAutoSaveBootstrapPlan(resolveOptions)
    assert.ok(plan)

    assert.equal(emitted.length, 1)
    const event = emitted[0] as Record<string, unknown>
    assert.equal(event?.event, 'flag_resolution')
    assert.equal(event?.feature, 'config.flags')
    assert.equal(event?.source, 'app.autosave')
    assert.equal(event?.phase, 'bootstrap')
    assert.match(String(event?.ts ?? ''), /^\d{4}-\d{2}-\d{2}T/)

    const snapshot = event?.snapshot as FlagSnapshot
    assert.deepEqual(snapshot.autosave, plan.snapshot.autosave)

    const errors = event?.errors as readonly FlagValidationError[]
    assert.ok(Array.isArray(errors))
    assert.ok(errors.length > 0)
    const [firstError] = errors
    assert.equal(firstError?.flag, 'autosave.enabled')
    assert.equal(firstError?.source, 'env')
    assert.equal(firstError?.phase, 'phase-a0')
  } finally {
    if (original) {
      scope.Day8Collector = original
    } else {
      delete scope.Day8Collector
    }
  }
})


test('resolvePluginBridgeBootstrapPlan publishes flag resolution telemetry with errors', () => {
  const emitted: unknown[] = []
  const scope = globalThis as { Day8Collector?: { publish: (event: unknown) => void } }
  const original = scope.Day8Collector
  scope.Day8Collector = {
    publish(event) {
      emitted.push(event)
    }
  }

  try {
    const resolveOptions: ResolveOptions = {
      env: {
        VITE_PLUGINS_ENABLE: 'invalid-value'
      }
    }

    const plan = resolvePluginBridgeBootstrapPlan(resolveOptions)
    assert.ok(plan)

    assert.equal(emitted.length, 1)
    const event = emitted[0] as Record<string, unknown>
    assert.equal(event?.event, 'flag_resolution')
    assert.equal(event?.feature, 'config.flags')
    assert.equal(event?.source, 'vscode.plugins')
    assert.equal(event?.phase, 'bootstrap')
    assert.match(String(event?.ts ?? ''), /^\d{4}-\d{2}-\d{2}T/)

    const snapshot = event?.snapshot as FlagSnapshot
    assert.deepEqual(snapshot.plugins, plan.snapshot.plugins)

    const errors = event?.errors as readonly FlagValidationError[]
    assert.ok(Array.isArray(errors))
    assert.ok(errors.length > 0)
    const [firstError] = errors
    assert.equal(firstError?.flag, 'plugins.enable')
    assert.equal(firstError?.source, 'env')
    assert.equal(firstError?.phase, 'phase-a1')
  } finally {
    if (original) {
      scope.Day8Collector = original
    } else {
      delete scope.Day8Collector
    }
  }
})
