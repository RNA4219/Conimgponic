import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'

import { ENABLED_GUARD, scenario } from './setup'

import { ProjectLockError, projectLockApi } from '../../../src/lib/locks'
import type { AutoSaveError } from '../../../src/lib/autosave'
import { createAutoSaveScheduler } from '../../../src/lib/autosave/scheduler'
import type { Storyboard } from '../../../src/types'

type LockManagerLike = {
  request(
    name: string,
    optionsOrCallback:
      | { signal?: AbortSignal }
      | ((lock: { release(): Promise<void> }) => Promise<unknown> | unknown),
    callback?: (lock: { release(): Promise<void> }) => Promise<unknown> | unknown
  ): Promise<unknown>
}

const makeStoryboard = (nodes: string[]): Storyboard => ({
  id: 'storyboard',
  title: 'Storyboard',
  scenes: nodes.map((id) => ({ id, manual: '', ai: '', status: 'idle', assets: [] })),
  selection: [],
  version: 1
})

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const isAutoSaveError = (
  expected: { code: AutoSaveError['code']; retryable: AutoSaveError['retryable'] }
) =>
  (error: unknown): error is AutoSaveError => {
    if (!error || typeof error !== 'object') return false
    const candidate = error as AutoSaveError
    return candidate.code === expected.code && candidate.retryable === expected.retryable
  }

const flushAllTimers = async (t: TestContext) => {
  await Promise.resolve()
  t.mock.timers.runAll()
}

scenario('scheduler transitions debouncing → awaiting-lock → gc with fake timers', async (t, ctx) => {
  const { initAutoSave, AUTOSAVE_POLICY } = ctx
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'], now: 0 })
  const phases: string[] = []
  const collectorEvents: unknown[] = []
  const runner = initAutoSave(() => makeStoryboard(['alpha']), { disabled: false }, ENABLED_GUARD)
  phases.push(runner.snapshot().phase)
  const pending = runner.flushNow().catch((error: unknown) => {
    collectorEvents.push(error)
    throw error
  })
  t.mock.timers.tick(AUTOSAVE_POLICY.debounceMs)
  phases.push(runner.snapshot().phase)
  t.mock.timers.tick(AUTOSAVE_POLICY.idleMs)
  phases.push(runner.snapshot().phase)
  await pending.catch(() => undefined)
  await flushAllTimers(t)
  phases.push(runner.snapshot().phase)
  assert.deepEqual(phases, ['debouncing', 'awaiting-lock', 'gc', 'idle'])
  assert.equal(collectorEvents.length, 0)
})

scenario('markDirty transitions snapshot to debouncing and updates pendingBytes', async (_t, ctx) => {
  const { initAutoSave } = ctx
  const runner = initAutoSave(() => makeStoryboard(['delta']), { disabled: false }, ENABLED_GUARD)
  runner.markDirty({ pendingBytes: 2048 })
  const snap = runner.snapshot()
  assert.equal(snap.phase, 'debouncing')
  assert.equal(snap.pendingBytes, 2048)
})

scenario('auto scheduler flushes after debounce+idle windows', async (t, ctx) => {
  const { initAutoSave, AUTOSAVE_POLICY, opfs } = ctx
  t.mock.timers.enable({ apis: ['setTimeout'], now: 0 })
  const runner = initAutoSave(() => makeStoryboard(['epsilon']), { disabled: false }, ENABLED_GUARD)
  runner.markDirty({ pendingBytes: 128 })
  assert.equal(runner.snapshot().phase, 'debouncing')

  t.mock.timers.tick(AUTOSAVE_POLICY.debounceMs - 1)
  await Promise.resolve()
  assert.equal(opfs.files.size, 0)
  assert.equal(runner.snapshot().phase, 'debouncing')

  t.mock.timers.tick(1)
  await Promise.resolve()
  assert.equal(opfs.files.size, 0)
  assert.equal(runner.snapshot().phase, 'debouncing')

  t.mock.timers.tick(AUTOSAVE_POLICY.idleMs - 1)
  await Promise.resolve()
  assert.equal(opfs.files.size, 0)
  assert.equal(runner.snapshot().phase, 'debouncing')

  t.mock.timers.tick(1)
  await Promise.resolve()
  await Promise.resolve()
  assert.ok(opfs.files.has('project/autosave/current.json'))
  assert.equal(runner.snapshot().phase, 'idle')
})

scenario('guard-disabled scheduler never starts timers', async (t, ctx) => {
  const { initAutoSave, AUTOSAVE_POLICY, opfs } = ctx
  t.mock.timers.enable({ apis: ['setTimeout'], now: 0 })
  const runner = initAutoSave(
    () => makeStoryboard(['zeta']),
    { disabled: false },
    { featureFlag: { value: false, source: 'env' }, optionsDisabled: false }
  )
  assert.equal(runner.snapshot().phase, 'disabled')
  runner.markDirty({ pendingBytes: 256 })
  assert.equal(runner.snapshot().phase, 'disabled')
  t.mock.timers.tick(AUTOSAVE_POLICY.debounceMs + AUTOSAVE_POLICY.idleMs)
  await Promise.resolve()
  assert.equal(opfs.files.size, 0)
  assert.equal(runner.snapshot().phase, 'disabled')
})

scenario('history guard enforces 20 generations and 50MB capacity', async (_t, ctx) => {
  const { initAutoSave, opfs, AUTOSAVE_POLICY } = ctx
  const runner = initAutoSave(() => makeStoryboard(['beta']), { disabled: false }, ENABLED_GUARD)
  const collectorEvents: unknown[] = []
  for (let i = 0; i < AUTOSAVE_POLICY.maxGenerations + 2; i++){
    try {
      await runner.flushNow()
      collectorEvents.push(undefined)
    } catch (error) {
      collectorEvents.push(error)
    }
  }
  const historyKeys = Array.from(opfs.files.keys()).filter((key) => key.startsWith('project/autosave/history/'))
  const totalBytes = historyKeys.reduce<number>((sum, key) => {
    const content = opfs.files.get(key)
    return sum + Buffer.byteLength(content ?? '', 'utf8')
  }, 0)
  assert.equal(historyKeys.length, AUTOSAVE_POLICY.maxGenerations)
  assert.ok(totalBytes <= AUTOSAVE_POLICY.maxBytes)
  assert.ok(collectorEvents.every((entry) => entry === undefined))
})

scenario(
  'retryable errors trigger backoff before transitioning to disabled on fatal failure',
  { locks: { async request(){ throw Object.assign(new Error('simulated lock failure'), { code: 'lock-unavailable' }) } } },
  async (t, ctx) => {
    const { initAutoSave, AUTOSAVE_RETRY_POLICY } = ctx
    t.mock.timers.enable({ apis: ['setTimeout'], now: Date.now() })
    const runner = initAutoSave(() => makeStoryboard(['gamma']), { disabled: false }, ENABLED_GUARD)
    const expectedError = { code: 'lock-unavailable', retryable: true } as const
    const rejection = await assert.rejects(runner.flushNow(), isAutoSaveError(expectedError))
    assert.ok(isAutoSaveError(expectedError)(rejection))
    const rejectedError = rejection as AutoSaveError
    assert.equal(runner.snapshot().phase, 'backoff')
    t.mock.timers.tick(AUTOSAVE_RETRY_POLICY.initialDelayMs - 1)
    await Promise.resolve()
    assert.equal(runner.snapshot().phase, 'backoff')
    t.mock.timers.tick(1)
    await Promise.resolve()
    assert.equal(runner.snapshot().phase, 'awaiting-lock')
    t.mock.timers.runAll()
    await Promise.resolve()
    assert.equal(runner.snapshot().phase, 'disabled')
    await runner.dispose()
    const finalSnapshot = runner.snapshot()
    assert.equal(finalSnapshot.phase, 'disabled')
    assert.equal(finalSnapshot.retryCount, 1)
    assert.equal(finalSnapshot.lastError?.code, rejectedError.code)
    assert.equal(finalSnapshot.lastError?.retryable, rejectedError.retryable)
  }
)

scenario(
  'aborting a pending web lock request yields a retryable acquisition error',
  async (_t, _ctx) => {
    const locks = (globalThis as { navigator: { locks: LockManagerLike } }).navigator.locks
    const ready = createDeferred<void>()
    const gate = createDeferred<void>()
    const done = createDeferred<void>()
    const holding = locks.request('project', async (lock) => {
      ready.resolve()
      await gate.promise
      await lock.release()
      done.resolve()
    })
    await ready.promise
    const controller = new AbortController()
    const attempt = projectLockApi.withProjectLock(async () => undefined, { signal: controller.signal })
    controller.abort()
    const rejection = await assert.rejects(attempt, (error): error is ProjectLockError => {
      return error instanceof ProjectLockError && error.code === 'acquire-denied'
    })
    assert.equal(rejection.retryable, true)
    gate.resolve()
    await done.promise
    await holding
  }
)

scenario('flushNow stays awaiting-lock until dispose finalizes disabled phase', async (t, ctx) => {
  const { initAutoSave } = ctx
  const runner = initAutoSave(() => makeStoryboard(['theta']), { disabled: false }, ENABLED_GUARD)
  const flushEntered = createDeferred<void>()
  const releaseFlush = createDeferred<void>()
  const lease = {
    leaseId: 'test-lease',
    ownerId: 'test-owner',
    strategy: 'web-lock' as const,
    viaFallback: false,
    resource: 'project',
    ttlMillis: 1000,
    acquiredAt: Date.now(),
    expiresAt: Date.now() + 1000,
    heartbeatIntervalMs: 500,
    nextHeartbeatAt: Date.now() + 500,
    renewAttempt: 0
  }
  t.mock.method(projectLockApi, 'withProjectLock', async (executor) => {
    flushEntered.resolve()
    await releaseFlush.promise
    return executor(lease)
  })

  const flush = runner.flushNow()
  await flushEntered.promise
  assert.equal(runner.snapshot().phase, 'awaiting-lock')

  const disposing = runner.dispose()
  assert.equal(runner.snapshot().phase, 'disabled')

  releaseFlush.resolve()
  await flush
  await disposing
  assert.equal(runner.snapshot().phase, 'disabled')
})

scenario('createAutoSaveScheduler handles flushNow/backoff sequencing', async (t, ctx) => {
  const { AUTOSAVE_POLICY } = ctx
  t.mock.timers.enable({ apis: ['setTimeout'], now: 0 })
  const flushes: Array<'change' | 'flushNow'> = []
  let backoffResumed = 0
  const scheduler = createAutoSaveScheduler(
    {
      onFlush: async (reason) => {
        flushes.push(reason)
      }
    },
    {
      debounceMs: AUTOSAVE_POLICY.debounceMs,
      idleMs: AUTOSAVE_POLICY.idleMs
    }
  )
  scheduler.start()
  scheduler.scheduleFlush('change')
  t.mock.timers.tick(AUTOSAVE_POLICY.debounceMs + AUTOSAVE_POLICY.idleMs - 1)
  await Promise.resolve()
  assert.deepEqual(flushes, [])
  t.mock.timers.tick(1)
  await Promise.resolve()
  assert.deepEqual(flushes, ['change'])

  scheduler.scheduleFlush('flushNow')
  assert.deepEqual(flushes, ['change', 'flushNow'])

  scheduler.enterBackoff({
    delayMs: 1000,
    reason: 'change',
    attempt: 1,
    onReady: () => {
      backoffResumed++
      scheduler.scheduleFlush('change')
    }
  })
  scheduler.scheduleFlush('flushNow')
  t.mock.timers.tick(1000)
  await Promise.resolve()
  assert.equal(backoffResumed, 0)

  scheduler.enterBackoff({
    delayMs: 500,
    reason: 'change',
    attempt: 1,
    onReady: () => {
      backoffResumed++
      scheduler.scheduleFlush('change')
    }
  })
  t.mock.timers.tick(500)
  await Promise.resolve()
  assert.ok(backoffResumed >= 1)
  assert.equal(flushes.at(-1), 'change')
})
