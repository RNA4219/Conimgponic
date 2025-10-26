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

type ExpectedFlagTelemetry = {
  readonly flag: string
  readonly variant: string
  readonly source: string
  readonly phase: string
}

const FLAG_PHASE_EXPECTATIONS: Record<string, string> = {
  'autosave.enabled': 'A-0',
  'plugins.enable': 'A-1',
  'merge.precision': 'B-0'
}

const expectFlagTelemetry = (
  emitted: readonly unknown[],
  config: {
    readonly origin: string
    readonly phase: string
    readonly evaluationMs: number
    readonly flags: ReadonlyArray<ExpectedFlagTelemetry>
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

  const correlationIds = new Set<string>()
  const reqIds = new Set<string>()

  const actual = events
    .map((event) => {
      const schema = event.schema
      assert.equal(schema, 'vscode.telemetry.v1')
      assert.equal(event.event, 'flag_resolution')
      assert.equal(event.type, 'telemetry.config.flags')
      assert.equal(event.apiVersion, 1)

      const phase = event.phase
      assert.equal(typeof phase, 'string')

      const attempt = event.attempt
      assert.equal(attempt, 1)

      const maxAttempts = event.maxAttempts
      assert.equal(maxAttempts, 3)

      const backoffMs = event.backoffMs as unknown
      assert.ok(Array.isArray(backoffMs))
      assert.deepEqual(backoffMs, [100, 300, 900])

      const correlationId = String(event.correlationId ?? '')
      const originPattern = config.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const phasePattern = config.phase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      assert.match(correlationId, new RegExp(`^${originPattern}:${phasePattern}:`))
      correlationIds.add(correlationId)

      const reqId = String(event.reqId ?? '')
      assert.ok(reqId.length > 0)
      reqIds.add(reqId)

      const ts = String(event.ts ?? '')
      assert.match(ts, /^\d{4}-\d{2}-\d{2}T/)

      const payload = event.payload as Record<string, unknown>
      assert.ok(payload)

      const evaluationMs = payload.evaluation_ms
      assert.equal(typeof evaluationMs, 'number')
      assert.equal(evaluationMs, config.evaluationMs)

      const flag = String(payload.flag)
      const variant = String(payload.variant)
      const source = String(payload.source)
      const payloadPhase = String(payload.phase)

      assert.equal(phase, payloadPhase)
      assert.equal(FLAG_PHASE_EXPECTATIONS[flag], payloadPhase)
      assert.ok(variant.length > 0)
      assert.ok(source.length > 0)

      return { flag, variant, source, phase: payloadPhase }
    })
    .sort((a, b) => a.flag.localeCompare(b.flag))

  assert.equal(correlationIds.size, 1)
  assert.equal(reqIds.size, events.length)

  const expected = config.flags
    .map((entry) => ({ ...entry }))
    .sort((a, b) => a.flag.localeCompare(b.flag))

  assert.deepEqual(actual, expected)
}

const snapshotFlags = (snapshot: FlagSnapshot): ReadonlyArray<ExpectedFlagTelemetry> => [
  {
    flag: 'autosave.enabled',
    variant: String(snapshot.autosave.value),
    source: snapshot.autosave.source,
    phase: FLAG_PHASE_EXPECTATIONS['autosave.enabled']
  },
  {
    flag: 'plugins.enable',
    variant: String(snapshot.plugins.value),
    source: snapshot.plugins.source,
    phase: FLAG_PHASE_EXPECTATIONS['plugins.enable']
  },
  {
    flag: 'merge.precision',
    variant: String(snapshot.merge.value),
    source: snapshot.merge.source,
    phase: FLAG_PHASE_EXPECTATIONS['merge.precision']
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

  const restorePerformance = stubPerformance([401, 409])

  try {
    const resolveOptions: ResolveOptions = {
      env: {
        VITE_PLUGINS_ENABLE: 'invalid-value'
      }
    }

    const plan = resolvePluginBridgeBootstrapPlan(resolveOptions)
    assert.ok(plan)
    assert.ok(Array.isArray(plan.errors))
    assert.ok(plan.errors.length > 0)

    expectFlagTelemetry(emitted, {
      origin: 'vscode.plugins',
      phase: 'bootstrap',
      evaluationMs: plan.evaluationMs,
      flags: snapshotFlags(plan.snapshot)
    })

    const [firstError] = plan.errors
    assert.equal(firstError?.flag, 'plugins.enable')
    assert.equal(firstError?.source, 'env')
    assert.equal(firstError?.phase, 'phase-a1')
  } finally {
    restorePerformance()
    if (original) {
      scope.Day8Collector = original
    } else {
      delete scope.Day8Collector
    }
  }
})
