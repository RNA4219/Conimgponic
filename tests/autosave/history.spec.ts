import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { beforeEach } from 'node:test'
import type { TestContext } from 'node:test'

import { ENABLED_GUARD, scenario } from '../lib/autosave/setup'
import type { AutoSaveInitResult } from '../../src/lib/autosave'
import { AUTOSAVE_RETRY_POLICY } from '../../src/lib/autosave'
import { ProjectLockError, projectLockApi } from '../../src/lib/locks'
import type { Storyboard } from '../../src/types'
import { collectAutoSaveWrites, reset } from './__mocks__/opfs'

const snapshotBase = new URL('./__snapshots__/autosave/on/', import.meta.url)

const readSnapshot = async (name: string): Promise<unknown> => {
  const file = new URL(`${name}.json`, snapshotBase)
  const data = await readFile(file, 'utf8')
  return JSON.parse(data)
}

const assertSnapshot = async (name: string, actual: unknown) => {
  try {
    const expected = await readSnapshot(name)
    assert.deepEqual(actual, expected)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error(`Missing snapshot ${name}:\n${JSON.stringify(actual, null, 2)}`)
    }
    throw error
  }
}

const createStoryboard = (): Storyboard => ({
  id: 'autosave-history',
  title: 'AutoSave History Test',
  scenes: [
    { id: 'intro', manual: 'Once upon a time', ai: 'A', status: 'idle', assets: [] },
    { id: 'conflict', manual: 'Conflict arises', ai: 'B', status: 'idle', assets: [] },
    { id: 'resolve', manual: 'Resolution', ai: 'C', status: 'idle', assets: [] }
  ],
  selection: [],
  version: 1
})

const makeCollector = () => {
  const telemetry: Array<Record<string, unknown>> = []
  Object.defineProperty(globalThis, 'Day8Collector', {
    value: {
      publish(event: Record<string, unknown>) {
        const { feature, event: name, phase, reason, code, retryable } = event
        telemetry.push(
          Object.fromEntries(
            Object.entries({ feature, event: name, phase, reason, code, retryable }).filter(([, value]) => value !== undefined)
          )
        )
      }
    },
    configurable: true
  })
  return telemetry
}

const waitForIdle = async (t: TestContext, runner: AutoSaveInitResult): Promise<void> => {
  for (let i = 0; i < 200; i += 1) {
    await Promise.resolve()
    await Promise.resolve()
    if (runner.snapshot().phase === 'idle') {
      return
    }
    t.mock.timers.tick(10)
  }
  throw new Error('Timed out waiting for runner to reach idle phase')
}

beforeEach(reset)

scenario('AS-I-02: idle flush persists autosave artefacts and rotates history', async (t, ctx) => {
  const telemetry = makeCollector()
  t.after(() => {
    delete (globalThis as { Day8Collector?: unknown }).Day8Collector
  })

  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2024, 0, 1, 0, 0, 0) })

  const policy = ctx.AUTOSAVE_POLICY
  const runner = ctx.initAutoSave(createStoryboard, { disabled: false }, ENABLED_GUARD)

  const flushViaIdle = async () => {
    runner.markDirty({ pendingBytes: 2048 })
    t.mock.timers.tick(policy.debounceMs)
    await Promise.resolve()
    t.mock.timers.tick(policy.idleMs)
    await waitForIdle(t, runner)
  }

  let firstHistoryPath: string | undefined

  for (let i = 0; i < policy.maxGenerations + 1; i += 1) {
    await flushViaIdle()
    if (i === 0) {
      const initialWrites = collectAutoSaveWrites(ctx.opfs)
      const initialHistory = initialWrites.find(({ path }) =>
        path.startsWith('project/autosave/history/')
      )
      assert.ok(initialHistory, 'first history snapshot should exist')
      firstHistoryPath = initialHistory.path
    }
    t.mock.timers.tick(10)
  }

  await runner.dispose()

  const historyWrites = collectAutoSaveWrites(ctx.opfs).filter(({ path }) =>
    path.startsWith('project/autosave/history/')
  )
  const historyPaths = historyWrites.map(({ path }) => path)
  const historyBytes = historyWrites.reduce((total, entry) => total + entry.bytes, 0)
  assert.ok(historyBytes <= policy.maxBytes)
  assert.ok(historyWrites.length <= policy.maxGenerations)
  assert.ok(firstHistoryPath)
  assert.ok(!historyPaths.includes(firstHistoryPath!), 'oldest history entry should be rotated out')

  const runnerTelemetry = ctx.runnerTelemetry

  const writeSucceededEvents = runnerTelemetry.filter(
    (event) => event.detail && (event.detail as { event?: unknown }).event === 'write-succeeded'
  )
  assert.ok(writeSucceededEvents.length > 0, 'write-succeeded telemetry should be recorded')
  writeSucceededEvents.forEach((event) => {
    assert.equal(event.phase, 'writing-current')
    assert.equal(event.slo, 'p99-success')
    const detail = event.detail as Record<string, unknown>
    assert.equal(detail.event, 'write-succeeded')
    assert.equal(typeof detail.bytes, 'number')
    assert.ok(Number.isFinite(detail.bytes), 'write-succeeded telemetry must include bytes')
    assert.equal(typeof detail.retryCount, 'number')
  })

  const gcCompletedEvents = runnerTelemetry.filter(
    (event) => event.detail && (event.detail as { event?: unknown }).event === 'gc-completed'
  )
  assert.ok(gcCompletedEvents.length > 0, 'gc-completed telemetry should be recorded')
  gcCompletedEvents.forEach((event) => {
    assert.equal(event.phase, 'gc')
    assert.equal(event.slo, 'p99-success')
    const detail = event.detail as Record<string, unknown>
    assert.equal(detail.event, 'gc-completed')
    assert.equal(typeof detail.bytes, 'number')
    assert.ok(Number.isFinite(detail.bytes), 'gc-completed telemetry must include bytes')
    assert.equal(typeof detail.retryCount, 'number')
  })

  const saveCompletedEvents = runnerTelemetry.filter(
    (event) => event.detail && (event.detail as { event?: unknown }).event === 'autosave.write.completed'
  )
  assert.ok(saveCompletedEvents.length > 0, 'autosave.write.completed telemetry should be recorded')
  saveCompletedEvents.forEach((event) => {
    assert.equal(event.phase, 'gc')
    assert.equal(event.slo, 'p99-success')
    const detail = event.detail as Record<string, unknown>
    assert.equal(detail.event, 'autosave.write.completed')
    assert.equal(typeof detail.duration_ms, 'number')
    assert.equal(detail.source, 'auto')
    const historySize = detail.history_size
    assert.equal(typeof historySize, 'number')
    assert.ok(
      Number.isFinite(historySize),
      'autosave.write.completed telemetry must include history_size'
    )
    const gcEvicted = detail.gc_evicted
    assert.equal(typeof gcEvicted, 'number')
    assert.ok(
      (gcEvicted as number) >= 0,
      'autosave.write.completed telemetry must include gc_evicted'
    )
  })

  const disposeEvents = runnerTelemetry.filter(
    (event) => event.detail && (event.detail as { event?: unknown }).event === 'autosave.save.error'
  )
  assert.ok(disposeEvents.length > 0, 'dispose should emit autosave.save.error telemetry')
  const disposeEvent = disposeEvents[disposeEvents.length - 1]!
  assert.equal(disposeEvent.phase, 'disabled')
  assert.equal(disposeEvent.slo, 'p95-latency')
  assert.equal((disposeEvent.detail as { reason?: unknown }).reason, 'dispose')

  assert.ok(telemetry.length > 0, 'autosave saves should publish telemetry events')
  telemetry.forEach((entry, index) => {
    assert.equal(entry.feature, 'autosave', `telemetry[${index}].feature should be autosave`)
    assert.equal(entry.event, 'autosave.write.completed', `telemetry[${index}].event should be autosave.write.completed`)
    assert.equal(entry.phase, 'A-1', `telemetry[${index}].phase should be A-1`)
  })

  const expectedTelemetry = telemetry.map(() => ({
    feature: 'autosave',
    event: 'autosave.write.completed',
    phase: 'A-1'
  }))

  const expectation = {
    history: historyWrites.map(({ bytes: _bytes, ...rest }) => rest),
    telemetry: expectedTelemetry
  }

  await assertSnapshot('history-as-i-02', expectation)
})

scenario('AS-I-06: retry scheduling emits autosave runner telemetry', async (t, ctx) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2024, 0, 2, 0, 0, 0) })

  const failure = new ProjectLockError('acquire-denied', 'Mock failure', {
    operation: 'acquire',
    retryable: true
  })
  const withProjectLockMock = t.mock.method(projectLockApi, 'withProjectLock', async () => {
    throw failure
  })
  t.after(() => {
    withProjectLockMock.mock.restore()
  })

  const runner = ctx.initAutoSave(createStoryboard, { disabled: false }, ENABLED_GUARD)
  t.after(async () => {
    await runner.dispose()
  })

  runner.markDirty({ pendingBytes: 4096 })
  const policy = ctx.AUTOSAVE_POLICY
  t.mock.timers.tick(policy.debounceMs)
  await Promise.resolve()
  t.mock.timers.tick(policy.idleMs)

  for (let i = 0; i < AUTOSAVE_RETRY_POLICY.maxAttempts; i += 1) {
    const delay = Math.min(
      AUTOSAVE_RETRY_POLICY.initialDelayMs * Math.pow(AUTOSAVE_RETRY_POLICY.multiplier, i),
      AUTOSAVE_RETRY_POLICY.maxDelayMs
    )
    t.mock.timers.tick(delay)
    await Promise.resolve()
    await Promise.resolve()
  }

  const runnerTelemetry = ctx.runnerTelemetry

  const retryScheduled = runnerTelemetry.filter(
    (event) => event.detail && (event.detail as { event?: unknown }).event === 'retry-scheduled'
  )
  assert.ok(retryScheduled.length >= AUTOSAVE_RETRY_POLICY.maxAttempts - 1)
  retryScheduled.forEach((event) => {
    assert.equal(event.phase, 'error')
    assert.equal(event.slo, 'p95-latency')
    const detail = event.detail as Record<string, unknown>
    assert.equal(detail.event, 'retry-scheduled')
    assert.equal(typeof detail.bytes, 'number')
    assert.equal(typeof detail.retryCount, 'number')
    assert.equal(typeof detail.delayMs, 'number')
  })

  const retryExhausted = runnerTelemetry.find(
    (event) => event.detail && (event.detail as { event?: unknown }).event === 'retry-exhausted'
  )
  assert.ok(retryExhausted, 'retry-exhausted telemetry should be recorded')
  assert.equal(retryExhausted.phase, 'awaiting-lock')
  assert.equal(retryExhausted.slo, 'p95-latency')
  const exhaustedDetail = retryExhausted.detail as Record<string, unknown>
  assert.equal(exhaustedDetail.event, 'retry-exhausted')
  assert.equal(exhaustedDetail.code, 'lock-unavailable')
  assert.equal(exhaustedDetail.retryCount, AUTOSAVE_RETRY_POLICY.maxAttempts)
})

scenario('AS-I-07: write failure publishes collector telemetry with cause detail', async (t, ctx) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2024, 0, 3, 0, 0, 0) })

  const failure = new Error('Mock OPFS failure')
  failure.name = 'MockOpfsWriteError'

  const opfsModule = await import('../../src/lib/opfs.ts')
  const originalSaveText = opfsModule.saveText
  const saveTextMock = t.mock.method(opfsModule, 'saveText', async (path: string, content: string) => {
    if (path === 'project/autosave/current.json.tmp') {
      throw failure
    }
    await originalSaveText(path, content)
  })
  t.after(() => {
    saveTextMock.mock.restore()
  })

  const runner = ctx.initAutoSave(createStoryboard, { disabled: false }, ENABLED_GUARD)
  t.after(async () => {
    await runner.dispose()
  })

  ctx.opfs.files.set(
    'project/autosave/index.json',
    JSON.stringify({ current: null, history: [], generation: null }, null, 2)
  )

  runner.markDirty({ pendingBytes: 1024 })

  await assert.rejects(async () => runner.flushNow(), (error: unknown) => {
    assert.equal((error as { code?: unknown }).code, 'write-failed')
    return true
  })

  const failureEvents = ctx.collectorEvents.filter((event) => event.event === 'autosave.write.failed')
  assert.ok(failureEvents.length > 0, 'collector must record autosave.write.failed event')
  const detail = failureEvents.at(-1)! as {
    feature?: unknown
    event?: unknown
    duration_ms?: unknown
    error_code?: unknown
    retryable?: unknown
    cause?: unknown
  }
  assert.equal(detail.feature, 'autosave')
  assert.equal(detail.event, 'autosave.write.failed')
  assert.equal(detail.error_code, 'write-failed')
  assert.equal(detail.retryable, true)
  assert.equal(detail.cause, failure.name)
  assert.equal(typeof detail.duration_ms, 'number')
  assert.ok((detail.duration_ms as number) >= 0)
})

let resumeLock: (() => Promise<void>) | null = null

scenario(
  'AS-I-05: dispose waits for in-flight flush and leaves artefacts consistent',
  {
    locks: {
      async request(
        _key: string,
        optionsOrCallback:
          | ((lock: { release: () => Promise<void> }) => Promise<void>)
          | { mode?: string; signal?: AbortSignal },
        maybeCallback?: (lock: { release: () => Promise<void> }) => Promise<void>
      ) {
        const callback =
          typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback ?? (() => Promise.resolve())
        await new Promise<void>((resolve) => {
          resumeLock = async () => {
            await callback({ async release() {} })
            resumeLock = null
            resolve()
          }
        })
      }
    }
  },
  async (t, ctx) => {
    const telemetry = makeCollector()
    t.after(() => {
      delete (globalThis as { Day8Collector?: unknown }).Day8Collector
    })

    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2024, 0, 1, 12, 0, 0) })

    resumeLock = null

    const runner = ctx.initAutoSave(createStoryboard, { disabled: false }, ENABLED_GUARD)
    runner.markDirty({ pendingBytes: 1024 })

    const pendingFlush = runner.flushNow()
    while (!resumeLock) {
      await Promise.resolve()
    }
    const disposePromise = runner.dispose()
    await resumeLock?.()
    await pendingFlush
    await disposePromise

    const writes = collectAutoSaveWrites(ctx.opfs)
    const expectation = {
      writes: writes.map(({ bytes: _bytes, ...rest }) => rest),
      telemetry
    }

    const historyBytes = writes
      .filter(({ path }) => path.startsWith('project/autosave/history/'))
      .reduce((total, entry) => total + entry.bytes, 0)
    assert.ok(historyBytes <= ctx.AUTOSAVE_POLICY.maxBytes)

    await assertSnapshot('history-as-i-05', expectation)
  }
)
