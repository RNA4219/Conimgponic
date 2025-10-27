import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FEATURE_FLAG_DEFINITIONS,
  resolveAutoSaveBootstrapPlan,
  resolvePluginBridgeBootstrapPlan,
  type FlagSnapshot,
  type FlagValidationError,
  type ResolveOptions
} from '../../src/config'
import { resolveAutoSaveBootstrapPlanForApp } from '../../src/App'
import { FLAG_RESOLUTION_SOURCE_VARIANTS } from '../../scripts/monitor/collect-metrics'

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

type FlagExpectation = {
  readonly flag: string
  readonly variant: string
  readonly source: string
  readonly phase: string
  readonly threshold: number | null
}

const expectFlagTelemetry = (
  emitted: readonly unknown[],
  config: {
    readonly origin: string
    readonly phase: string
    readonly evaluationMs: number
    readonly flags: readonly FlagExpectation[]
  }
): void => {
  const events = emitted.filter(
    (candidate): candidate is Record<string, unknown> =>
      !!candidate &&
      typeof candidate === 'object' &&
      (candidate as Record<string, unknown>).event === 'flag_resolution' &&
      (candidate as Record<string, unknown>).schema === 'vscode.telemetry.v1'
  )
  assert.equal(events.length, config.flags.length)
  assert.equal(events.length, emitted.length)

  const actual = events
    .map((event) => {
      assert.equal(event.feature, 'config.flags')
      assert.equal(event.event, 'flag_resolution')
      assert.equal(event.source, config.origin)
      assert.equal(event.phase, config.phase)
      assert.equal(event.schema, 'vscode.telemetry.v1')

      const evaluationMs = event.evaluation_ms
      assert.equal(typeof evaluationMs, 'number')
      assert.ok(Number.isFinite(evaluationMs))
      assert.equal(evaluationMs, config.evaluationMs)

      assert.ok(!('snapshot' in event))
      assert.ok(!('errors' in event))

      const payload = (event as { payload?: Record<string, unknown> }).payload
      assert.ok(payload && typeof payload === 'object', 'flag_resolution payload must be provided')

      const flag = String(payload.flag)
      const variant = String(payload.variant)
      const source = String(payload.source)
      const phase = String(payload.phase)
      const payloadEvaluation = payload.evaluation_ms
      assert.equal(payloadEvaluation, config.evaluationMs)

      const hasThreshold = 'threshold' in payload
      assert.equal(hasThreshold, true, 'flag_resolution payload must include threshold')
      const thresholdValue = payload.threshold as number | null
      if (entry.threshold === null) {
        assert.equal(thresholdValue, null)
      } else {
        assert.equal(typeof thresholdValue, 'number')
        assert.ok(Number.isFinite(thresholdValue))
        assert.equal(thresholdValue, entry.threshold)
      }

      assert.ok(
        FLAG_RESOLUTION_SOURCE_VARIANTS.includes(source as (typeof FLAG_RESOLUTION_SOURCE_VARIANTS)[number]),
        `flag_resolution payload source must be one of ${FLAG_RESOLUTION_SOURCE_VARIANTS.join(', ')}`
      )
      assert.ok(!('errors' in payload))

      return {
        flag,
        variant,
        source,
        phase,
        threshold: thresholdValue
      }
    })
    .sort((a, b) => a.flag.localeCompare(b.flag))

  const expected = config.flags
    .map((entry) => ({
      flag: entry.flag,
      variant: entry.variant,
      source: entry.source,
      phase: entry.phase,
      threshold: entry.threshold
    }))
    .sort((a, b) => a.flag.localeCompare(b.flag))

  assert.deepEqual(actual, expected)
}

const snapshotFlags = (snapshot: FlagSnapshot): readonly FlagExpectation[] => [
  {
    flag: 'autosave.enabled',
    variant: String(snapshot.autosave.value),
    source: snapshot.autosave.source,
    phase: FEATURE_FLAG_DEFINITIONS['autosave.enabled'].phase,
    threshold: null
  },
  {
    flag: 'plugins.enable',
    variant: String(snapshot.plugins.value),
    source: snapshot.plugins.source,
    phase: FEATURE_FLAG_DEFINITIONS['plugins.enable'].phase,
    threshold: null
  },
  {
    flag: 'merge.precision',
    variant: String(snapshot.merge.value),
    source: snapshot.merge.source,
    phase: FEATURE_FLAG_DEFINITIONS['merge.precision'].phase,
    threshold: snapshot.merge.threshold
  }
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
    expectFlagTelemetry(emitted, {
      origin: 'vscode.plugins',
      phase: 'bootstrap',
      evaluationMs: plan.evaluationMs,
      flags: snapshotFlags(plan.snapshot)
    })

    const pluginEvent = emitted.find((candidate) => {
      const payload = (candidate as { payload?: { flag?: unknown } }).payload
      return payload?.flag === 'plugins.enable'
    }) as { payload?: { errors?: readonly FlagValidationError[] } } | undefined
    assert.ok(pluginEvent, 'flag_resolution telemetry should include plugins.enable payload')

    const payloadErrors = pluginEvent?.payload?.errors
    assert.ok(Array.isArray(payloadErrors))
    assert.deepEqual(payloadErrors, plan.snapshot.plugins.errors)
    assert.ok(payloadErrors.length > 0)
    const [firstError] = payloadErrors
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
