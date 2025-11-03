import assert from 'node:assert/strict'
import test from 'node:test'

import {
  publishGuardCollectorEvent,
  publishScheduleRequestedCollectorEvent,
  publishWriteCompletedCollectorEvent
} from '../../../src/lib/autosave/telemetryBridge'
import type { AutoSavePhaseGuardSnapshot } from '../../../src/lib/autosave'

const createGuard = (overrides: Partial<AutoSavePhaseGuardSnapshot> = {}): AutoSavePhaseGuardSnapshot => ({
  featureFlag: { value: true, source: 'env' },
  optionsDisabled: false,
  ...overrides
})

test('publishGuardCollectorEvent sends structured payload to Day8Collector', (t) => {
  const published: Record<string, unknown>[] = []
  const scope = globalThis as typeof globalThis & { Day8Collector?: { publish: (event: Record<string, unknown>) => void } }
  const previous = scope.Day8Collector
  scope.Day8Collector = {
    publish: (event) => {
      published.push(event)
    }
  }
  t.after(() => {
    if (previous) {
      scope.Day8Collector = previous
    } else {
      delete scope.Day8Collector
    }
  })

  const guard = createGuard()
  publishGuardCollectorEvent(guard, 'feature-flag-disabled')

  assert.equal(published.length, 1)
  const [event] = published
  assert.equal(event.feature, 'autosave-diff-merge')
  assert.equal(event.event, 'autosave.guard')
  assert.equal(event.blocked, true)
  assert.equal(event.phase, 'disabled')
  assert.equal(event.reason, 'feature-flag-disabled')
  assert.deepEqual(event.guard, guard)
  assert.ok(typeof event.ts === 'string')
  assert.equal(new Date(event.ts as string).toISOString(), event.ts)
})

test('publishWriteCompletedCollectorEvent normalises payload before publishing', (t) => {
  const published: Record<string, unknown>[] = []
  const scope = globalThis as typeof globalThis & { Day8Collector?: { publish: (event: Record<string, unknown>) => void } }
  const previous = scope.Day8Collector
  scope.Day8Collector = {
    publish: (event) => {
      published.push(event)
    }
  }
  t.after(() => {
    if (previous) {
      scope.Day8Collector = previous
    } else {
      delete scope.Day8Collector
    }
  })

  const guard = createGuard({ featureFlag: { value: true, source: 'localStorage' } })
  publishWriteCompletedCollectorEvent({
    guard,
    durationMs: 12.4,
    bytes: 2048,
    generation: 3,
    retryCount: 2,
    source: 'auto',
    ts: '2024-01-01T00:00:00.000Z',
    historyBytes: 4096,
    gcEvicted: 1
  })

  assert.equal(published.length, 1)
  const [event] = published
  assert.equal(event.component, 'autosave')
  assert.equal(event.feature, 'autosave')
  assert.equal(event.event, 'autosave.write.completed')
  assert.equal(event.phase, 'A-1')
  assert.equal(event.ts, '2024-01-01T00:00:00.000Z')
  assert.equal(event.duration_ms, 12)
  assert.equal(event.bytes, 2048)
  assert.equal(event.history_size, 4096)
  assert.equal(event.gc_evicted, 1)
  assert.equal(event.generation, 3)
  assert.equal(event.retry_count, 2)
  assert.equal(event.source, 'auto')
  assert.ok(!('lease_id' in event))
})

test('publishScheduleRequestedCollectorEvent includes build SHA and guard metadata', (t) => {
  const published: Record<string, unknown>[] = []
  const scope = globalThis as typeof globalThis & { Day8Collector?: { publish: (event: Record<string, unknown>) => void } }
  const previous = scope.Day8Collector
  scope.Day8Collector = {
    publish: (event) => {
      published.push(event)
    }
  }
  t.after(() => {
    if (previous) {
      scope.Day8Collector = previous
    } else {
      delete scope.Day8Collector
    }
  })

  const guard = createGuard({ featureFlag: { value: true, source: 'workspace' } })
  publishScheduleRequestedCollectorEvent({
    guard,
    ts: '2024-02-01T00:00:00.000Z',
    reason: 'change',
    pendingBytes: 1024,
    backlog: 4,
    retryCount: 1,
    buildSha: 'sha-build'
  })

  assert.equal(published.length, 1)
  const [event] = published
  assert.equal(event.event, 'autosave.schedule.requested')
  assert.equal(event.phase, 'A-2')
  assert.equal(event.build_sha, 'sha-build')
  assert.equal(event.reason, 'change')
  assert.equal(event.pending_bytes, 1024)
  assert.equal(event.backlog, 4)
  assert.equal(event.flag_source, 'workspace')
  assert.equal(event.retry_count, 1)
})
