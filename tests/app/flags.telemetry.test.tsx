import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveAutoSaveBootstrapPlan,
  resolvePluginBridgeBootstrapPlan,
  type FlagSnapshot,
  type FlagValidationError,
  type ResolveOptions
} from '../../src/config'
import { resolveAutoSaveBootstrapPlanForApp } from '../../src/App'

const stubPerformance = (values: readonly number[]): (() => void) => {
  const scope = globalThis as typeof globalThis & {
    performance?: { now(): number }
  }
  const original = scope.performance
  const remaining = [...values]
  scope.performance = {
    now() {
      const next = remaining.shift()
      if (typeof next === 'number') {
        return next
      }
      return remaining[0] ?? 0
    }
  } as Performance
  return () => {
    if (original) {
      scope.performance = original
    } else {
      delete scope.performance
    }
  }
}

test('resolveAutoSaveBootstrapPlan publishes flag resolution telemetry with errors', () => {
  const emitted: unknown[] = []
  const scope = globalThis as { Day8Collector?: { publish: (event: unknown) => void } }
  const originalCollector = scope.Day8Collector
  scope.Day8Collector = {
    publish(event) {
      emitted.push(event)
    }
  }

  const restorePerformance = stubPerformance([101, 149])

  try {
    const resolveOptions: ResolveOptions = {
      env: {
        VITE_AUTOSAVE_ENABLED: 'definitely-not-boolean'
      }
    }

    const plan = resolveAutoSaveBootstrapPlan(resolveOptions)
    assert.ok(plan)
    const planErrors = plan.errors
    assert.ok(Array.isArray(planErrors), 'AutoSave bootstrap plan should expose validation errors as an array')

    assert.equal(emitted.length, 1)
    const event = emitted[0] as Record<string, unknown>
    assert.equal(event?.event, 'flag_resolution')
    assert.equal(event?.feature, 'config.flags')
    assert.equal(event?.source, 'app.autosave')
    assert.equal(event?.phase, 'bootstrap')
    assert.match(String(event?.ts ?? ''), /^\d{4}-\d{2}-\d{2}T/)

    const evaluationMs = event?.evaluation_ms
    assert.equal(typeof evaluationMs, 'number')
    assert.ok(Number.isFinite(evaluationMs))
    assert.equal(evaluationMs, 48)
    assert.ok(evaluationMs >= 0)

    const snapshot = event?.snapshot as FlagSnapshot
    assert.deepEqual(snapshot.autosave, plan.snapshot.autosave)

    const errors = event?.errors as readonly FlagValidationError[]
    assert.ok(Array.isArray(errors))
    assert.ok(errors.length > 0)
    assert.equal(errors, planErrors)
    const [firstError] = errors
    assert.equal(firstError?.flag, 'autosave.enabled')
    assert.equal(firstError?.source, 'env')
    assert.equal(firstError?.phase, 'phase-a0')
  } finally {
    restorePerformance()
    if (originalCollector) {
      scope.Day8Collector = originalCollector
    } else {
      delete scope.Day8Collector
    }
  }
})

test('resolveAutoSaveBootstrapPlan publishes a single flag resolution telemetry event without duplicates', () => {
  const emitted: unknown[] = []
  const scope = globalThis as { Day8Collector?: { publish: (event: unknown) => void } }
  const originalCollector = scope.Day8Collector
  scope.Day8Collector = {
    publish(event) {
      emitted.push(event)
    }
  }

  const restorePerformance = stubPerformance([201, 269])

  try {
    const plan = resolveAutoSaveBootstrapPlan()

    assert.ok(plan)
    assert.equal(emitted.length, 1)

    const event = emitted[0] as Record<string, unknown>
    assert.equal(event?.event, 'flag_resolution')
    assert.equal(event?.feature, 'config.flags')
    assert.equal(event?.source, 'app.autosave')
    assert.equal(event?.phase, 'bootstrap')
    assert.match(String(event?.ts ?? ''), /^\d{4}-\d{2}-\d{2}T/)

    const evaluationMs = event?.evaluation_ms
    assert.equal(typeof evaluationMs, 'number')
    assert.ok(Number.isFinite(evaluationMs))
    assert.equal(evaluationMs, 68)
    assert.ok(evaluationMs >= 0)

    const snapshot = event?.snapshot as FlagSnapshot
    assert.deepEqual(snapshot, plan.snapshot)

    const errors = event?.errors as readonly FlagValidationError[]
    assert.equal(errors, plan.errors)
    assert.ok(Array.isArray(errors))
    assert.equal(errors.length, 0)
  } finally {
    restorePerformance()
    if (originalCollector) {
      scope.Day8Collector = originalCollector
    } else {
      delete scope.Day8Collector
    }
  }
})

test('App bootstrap publishes flag resolution telemetry only once', () => {
  const scope = globalThis as { Day8Collector?: { publish: (event: unknown) => void } }
  const originalCollector = scope.Day8Collector
  const emitted: unknown[] = []
  scope.Day8Collector = {
    publish(event) {
      emitted.push(event)
    }
  }

  const restorePerformance = stubPerformance([311, 359])

  try {
    const recorded: unknown[] = []
    const plan = resolveAutoSaveBootstrapPlanForApp((nextPlan) => {
      recorded.push(nextPlan)
    })

    assert.equal(emitted.length, 1)
    const event = emitted[0] as Record<string, unknown>
    assert.equal(event?.event, 'flag_resolution')
    assert.equal(event?.feature, 'config.flags')
    assert.equal(event?.source, 'app.autosave')
    assert.equal(event?.phase, 'bootstrap')
    assert.match(String(event?.ts ?? ''), /^\d{4}-\d{2}-\d{2}T/)

    const evaluationMs = event?.evaluation_ms
    assert.equal(typeof evaluationMs, 'number')
    assert.ok(Number.isFinite(evaluationMs))
    assert.equal(evaluationMs, 48)
    assert.ok(evaluationMs >= 0)

    const snapshot = event?.snapshot as FlagSnapshot
    assert.deepEqual(snapshot, plan.snapshot)

    const errors = event?.errors as readonly FlagValidationError[]
    assert.equal(errors, plan.errors)

    assert.equal(recorded.length, 1)
    assert.strictEqual(recorded[0], plan)
  } finally {
    restorePerformance()
    if (originalCollector) {
      scope.Day8Collector = originalCollector
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
    assert.ok(Array.isArray(plan.errors))

    assert.equal(emitted.length, 1)
    const event = emitted[0] as Record<string, unknown>
    assert.equal(event?.event, 'flag_resolution')
    assert.equal(event?.feature, 'config.flags')
    assert.equal(event?.source, 'vscode.plugins')
    assert.equal(event?.phase, 'bootstrap')
    assert.match(String(event?.ts ?? ''), /^\d{4}-\d{2}-\d{2}T/)

    const evaluationMs = event?.evaluation_ms
    assert.equal(typeof evaluationMs, 'number')
    assert.ok(Number.isFinite(evaluationMs))
    assert.ok(evaluationMs >= 0)

    const snapshot = event?.snapshot as FlagSnapshot
    assert.deepEqual(snapshot.plugins, plan.snapshot.plugins)

    const errors = event?.errors as readonly FlagValidationError[]
    assert.ok(Array.isArray(errors))
    assert.ok(errors.length > 0)
    assert.equal(errors, plan.errors)
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
