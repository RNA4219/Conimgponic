import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveAutoSaveBootstrapPlan,
  resolvePluginBridgeBootstrapPlan,
  type FlagSnapshot,
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

const expectFlagTelemetry = (
  emitted: readonly unknown[],
  config: {
    readonly origin: string
    readonly phase: string
    readonly evaluationMs: number
    readonly flags: ReadonlyArray<readonly [string, unknown]>
  }
): void => {
  const events = emitted.filter(
    (candidate): candidate is Record<string, unknown> =>
      !!candidate &&
      typeof candidate === 'object' &&
      (candidate as Record<string, unknown>).event === 'flag_resolution'
  )
  assert.equal(events.length, config.flags.length)
  assert.equal(events.length, emitted.length)

  const actual = events
    .map((event) => {
      assert.equal(event.feature, 'config.flags')
      assert.equal(event.event, 'flag_resolution')
      assert.equal(event.source, config.origin)
      assert.equal(event.phase, config.phase)

      const evaluationMs = event.evaluation_ms
      assert.equal(typeof evaluationMs, 'number')
      assert.ok(Number.isFinite(evaluationMs))
      assert.equal(evaluationMs, config.evaluationMs)

      return [String(event.flag), event.variant] as const
    })
    .sort((a, b) => a[0].localeCompare(b[0]))

  const expected = config.flags
    .map(([flag, variant]) => [flag, variant] as const)
    .sort((a, b) => a[0].localeCompare(b[0]))

  assert.deepEqual(actual, expected)
}

const snapshotFlags = (snapshot: FlagSnapshot): ReadonlyArray<readonly [string, unknown]> => [
  ['autosave.enabled', snapshot.autosave.value] as const,
  ['plugins.enable', snapshot.plugins.value] as const,
  ['merge.precision', snapshot.merge.value] as const
]

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

    expectFlagTelemetry(emitted, {
      origin: 'app.autosave',
      phase: 'bootstrap',
      evaluationMs: 48,
      flags: snapshotFlags(plan.snapshot)
    })

    const autosaveErrors = planErrors.filter((error) => error.flag === 'autosave.enabled')
    assert.ok(autosaveErrors.length > 0)
    const [firstError] = autosaveErrors
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
    expectFlagTelemetry(emitted, {
      origin: 'app.autosave',
      phase: 'bootstrap',
      evaluationMs: 68,
      flags: snapshotFlags(plan.snapshot)
    })
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

    expectFlagTelemetry(emitted, {
      origin: 'app.autosave',
      phase: 'bootstrap',
      evaluationMs: 48,
      flags: snapshotFlags(plan.snapshot)
    })

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
