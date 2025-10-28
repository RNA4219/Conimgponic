/// <reference types="node" />

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import type { TestContext } from 'node:test'

import {
  acquireProjectLock,
  releaseProjectLock,
  projectLockEvents,
  WEB_LOCK_KEY,
  FALLBACK_LOCK_PATH,
  FALLBACK_LOCK_TTL_MS,
  WEB_LOCK_TTL_MS,
  type ProjectLockEvent
} from '../../src/lib/locks'
import { ProjectLockError, projectLockApi } from '../../src/lib/locks'
import {
  ENABLED_GUARD,
  scenario as baseScenario,
  type ScenarioContext,
  type SetupOverrides
} from '../lib/autosave/setup'
import type { Storyboard } from '../../src/types'

type LockScenarioHandler = (t: TestContext, ctx: ScenarioContext) => unknown | Promise<unknown>

const assertNoRunnerTelemetry = (ctx: ScenarioContext): void => {
  assert.equal(
    ctx.runnerTelemetry.length,
    0,
    'AutoSave runner telemetry must remain empty during lock scenarios'
  )
}

const createStoryboard = (): Storyboard => ({
  id: 'autosave-lock-telemetry',
  title: 'AutoSave Lock Telemetry',
  scenes: [
    { id: 'scene-1', manual: 'Lock telemetry check', ai: 'Lock', status: 'idle', assets: [] }
  ],
  selection: [],
  version: 1
})

const scenario = (
  name: string,
  overridesOrHandler: SetupOverrides | LockScenarioHandler,
  handler?: LockScenarioHandler
): void => {
  if (typeof overridesOrHandler === 'function') {
    baseScenario(name, async (t, ctx) => {
      await overridesOrHandler(t, ctx)
      assertNoRunnerTelemetry(ctx)
    })
    return
  }
  baseScenario(name, overridesOrHandler, async (t, ctx) => {
    await handler!(t, ctx)
    assertNoRunnerTelemetry(ctx)
  })
}

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

type LockSnapshotEvent =
  | 'attempt:web-lock'
  | 'attempt:file-lock'
  | 'fallback-engaged'
  | 'warning:fallback-engaged'
  | 'acquired:web-lock'
  | 'acquired:file-lock'
  | 'released'
  | 'error:acquire-denied:retryable=false'
  | 'error:acquire-denied:retryable=true'

type TelemetrySnapshot = Array<Record<string, unknown>>

type LockHandleLike = { release(): Promise<void> }

const collectLockSequence = (telemetry: TelemetrySnapshot) => {
  const sequence: LockSnapshotEvent[] = []
  const unsubscribe = projectLockEvents.subscribe((event) => {
    switch (event.type) {
      case 'lock:attempt':
        sequence.push(event.strategy === 'web-lock' ? 'attempt:web-lock' : 'attempt:file-lock')
        break
      case 'lock:warning':
        if (event.warning === 'fallback-engaged') {
          sequence.push('warning:fallback-engaged')
        }
        break
      case 'lock:fallback-engaged':
        sequence.push('fallback-engaged')
        break
      case 'lock:acquired':
        sequence.push(event.lease.strategy === 'web-lock' ? 'acquired:web-lock' : 'acquired:file-lock')
        break
      case 'lock:released':
        sequence.push('released')
        break
      case 'lock:error':
        sequence.push(event.retryable ? 'error:acquire-denied:retryable=true' : 'error:acquire-denied:retryable=false')
        telemetry.push({ type: event.type, code: event.error.code, retryable: event.retryable, operation: event.operation })
        break
      case 'lock:readonly-entered':
        telemetry.push({ type: event.type, reason: event.reason, retryable: event.retryable })
        break
      default:
        break
    }
  })
  return { sequence, unsubscribe }
}

scenario(
  'AS-I-03: Web Lock collision falls back to file lock and records telemetry',
  {
    locks: {
      async request() {
        throw new DOMException('Lock already held', 'AbortError')
      }
    }
  },
  async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
    const uuids = ['lease-a', 'owner-a', 'lease-b', 'owner-b']
    t.mock.method(crypto, 'randomUUID', () => {
      const value = uuids.shift()
      if (!value) throw new Error('uuid exhausted')
      return value
    })

    const telemetry: TelemetrySnapshot = []
    const { sequence, unsubscribe } = collectLockSequence(telemetry)
    t.after(unsubscribe)

    const lease = await projectLockApi.acquire({ preferredStrategy: 'web-lock' })
    const telemetryBeforeRelease = telemetry.slice()
    try {
      await projectLockApi.release(lease)
    } catch (error) {
      if (error instanceof ProjectLockError && error.code === 'release-failed') {
        assert.fail('projectLockApi.release must not throw release-failed for Web Lock fallback path')
      }
      throw error
    }
    assert.deepEqual(
      telemetry,
      telemetryBeforeRelease,
      'Collector telemetry must remain intact after projectLockApi.release'
    )

    await assertSnapshot('locks-as-i-03', { lockSequence: sequence, telemetry })
  }
)

scenario(
  'AS-I-03: Web Lock collision falls back to file lock but fallback acquisition fails with telemetry',
  {
    locks: {
      async request() {
        throw new DOMException('Lock already held', 'AbortError')
      }
    }
  },
  async (t, { opfs }) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
    const uuids = ['lease-fallback', 'owner-fallback']
    t.mock.method(crypto, 'randomUUID', () => {
      const value = uuids.shift()
      if (!value) throw new Error('uuid exhausted')
      return value
    })

    const fallbackFailure = new ProjectLockError('acquire-denied', 'Mock fallback failure', {
      operation: 'acquire',
      retryable: false
    })
    const originalGetDirectory = opfs.storage.getDirectory
    const wrapDirectory = (
      directory: Awaited<ReturnType<typeof originalGetDirectory>>
    ): Awaited<ReturnType<typeof originalGetDirectory>> => {
      const getDirectoryHandle = directory.getDirectoryHandle.bind(directory)
      return {
        ...directory,
        async getDirectoryHandle(name: string, options?: { create?: boolean }) {
          const next = await getDirectoryHandle(name, options as { create?: boolean })
          return wrapDirectory(next)
        },
        async getFileHandle(name: string) {
          throw fallbackFailure
        }
      }
    }
    opfs.storage.getDirectory = async () => wrapDirectory(await originalGetDirectory())
    t.after(() => {
      opfs.storage.getDirectory = originalGetDirectory
    })

    const telemetry: TelemetrySnapshot = []
    const { sequence, unsubscribe } = collectLockSequence(telemetry)
    t.after(unsubscribe)

    await assert.rejects(async () => projectLockApi.acquire({ preferredStrategy: 'web-lock' }), (error: unknown) => {
      assert.ok(error instanceof ProjectLockError)
      assert.equal(error.retryable, false)
      return true
    })

    await assertSnapshot('locks-as-i-03-fallback-error', { lockSequence: sequence, telemetry })
  }
)

scenario(
  'AS-LK-15: Web Lock acquisition abort skips fallback and enters readonly immediately',
  {
    locks: {
      request(key, options) {
        assert.equal(key, WEB_LOCK_KEY)
        const signal = options?.signal
        return new Promise((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Web Lock acquisition aborted', 'AbortError'))
            },
            { once: true }
          )
        })
      },
    },
  },
  async (t) => {
    const telemetry: TelemetrySnapshot = []
    const { sequence, unsubscribe } = collectLockSequence(telemetry)
    t.after(unsubscribe)

    const controller = new AbortController()
    const acquirePromise = projectLockApi.acquire({ signal: controller.signal })
    controller.abort(new DOMException('Abort web lock', 'AbortError'))

    const error = (await assert.rejects(async () => {
      await acquirePromise
    })) as ProjectLockError

    assert.ok(error instanceof ProjectLockError, 'abort must surface as ProjectLockError')
    assert.equal(error.code, 'acquire-denied', 'abort must report acquire-denied code')
    assert.equal(error.retryable, false, 'abort must be treated as non-retryable')

    assert.deepEqual(sequence, ['attempt:web-lock', 'error:acquire-denied:retryable=false'])
    assert.deepEqual(telemetry, [
      { type: 'lock:error', code: 'acquire-denied', retryable: false, operation: 'acquire' },
      { type: 'lock:readonly-entered', reason: 'acquire-failed', retryable: false }
    ])
  }
)

baseScenario(
  'AS-I-07: Successful lock acquisition emits autosave runner telemetry',
  async (t, ctx) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2024, 0, 1) })

    const runner = ctx.initAutoSave(createStoryboard, { disabled: false }, ENABLED_GUARD)
    t.after(async () => {
      await runner.dispose()
    })

    runner.markDirty({ pendingBytes: 4096 })
    await runner.flushNow()

    const lockEvents = ctx.runnerTelemetry.filter((event) => {
      const detail = event.detail as { event?: unknown } | undefined
      return detail?.event === 'lock-acquired'
    })

    assert.ok(lockEvents.length > 0, 'lock-acquired telemetry should be recorded after successful flush')

    const lockEvent = lockEvents[0]!
    assert.equal(lockEvent.phase, 'awaiting-lock')
    assert.equal(lockEvent.slo, 'p95-latency')

    const detail = lockEvent.detail as Record<string, unknown>
    assert.equal(detail.event, 'lock-acquired')
    assert.equal(detail.retryCount, 0)
    assert.equal(detail.strategy, 'web-lock')
    assert.equal(detail.leaseMs, WEB_LOCK_TTL_MS)
    assert.equal(detail.viaFallback, false)

    const writeSucceededIndex = ctx.runnerTelemetry.findIndex(
      (event) => (event.detail as { event?: unknown } | undefined)?.event === 'write-succeeded'
    )
    const lockAcquiredIndex = ctx.runnerTelemetry.indexOf(lockEvent)
    assert.ok(
      writeSucceededIndex === -1 || lockAcquiredIndex <= writeSucceededIndex,
      'lock-acquired telemetry must precede write-succeeded events'
    )
  }
)

baseScenario(
  'AS-I-08: AutoSave runner telemetry exposes lease metadata after lock acquisition',
  async (t, ctx) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2024, 0, 1) })

    const runner = ctx.initAutoSave(createStoryboard, { disabled: false }, ENABLED_GUARD)
    t.after(async () => {
      await runner.dispose()
    })

    runner.markDirty({ pendingBytes: 1024 })
    await runner.flushNow()

    const lockEvent = ctx.runnerTelemetry.find((event) => {
      return (event.detail as { event?: string } | undefined)?.event === 'lock-acquired'
    })

    assert.ok(lockEvent, 'lock-acquired telemetry event must exist after flush')
    assert.equal(lockEvent!.phase, 'awaiting-lock')

    const detail = lockEvent!.detail as Record<string, unknown>
    assert.equal(detail.retryCount, 0)

    const lease = detail.lease as Record<string, unknown> | undefined
    assert.ok(lease, 'lock-acquired telemetry must include lease metadata')
    assert.equal(typeof lease!.leaseId, 'string')
    assert.equal(typeof lease!.ownerId, 'string')
    assert.equal(lease!.strategy, 'web-lock')
    assert.equal(lease!.viaFallback, false)
    assert.equal(typeof lease!.ttlMillis, 'number')
    assert.equal(typeof lease!.resource, 'string')
  }
)

scenario(
  'AS-I-03: Fallback acquisition aborts immediately when signal is already aborted',
  {
    navigator: { locks: undefined }
  },
  async (t, ctx) => {
    const telemetry: TelemetrySnapshot = []
    const { sequence, unsubscribe } = collectLockSequence(telemetry)
    t.after(unsubscribe)

    const controller = new AbortController()
    controller.abort(new DOMException('User aborted lock acquisition', 'AbortError'))

    const error = (await assert.rejects(async () => {
      await projectLockApi.acquire({
        preferredStrategy: 'file-lock',
        signal: controller.signal,
        retry: false
      })
    })) as ProjectLockError

    assert.ok(error instanceof ProjectLockError, 'acquire must reject with ProjectLockError')
    assert.equal(error.code, 'acquire-denied', 'error code must indicate acquisition denied')
    assert.equal(error.retryable, true, 'abort-triggered failure must remain retryable')

    assert.deepEqual(sequence, ['attempt:file-lock', 'error:acquire-denied:retryable=true'])
    assert.deepEqual(telemetry, [
      { type: 'lock:error', code: 'acquire-denied', retryable: true, operation: 'acquire' },
      { type: 'lock:readonly-entered', reason: 'acquire-failed', retryable: false }
    ])

    assert.equal(
      ctx.opfs.files.has('project/.lock'),
      false,
      'fallback lock file must not be created when acquisition aborts before start'
    )
  }
)

scenario(
  'AS-LK-12: Fallback acquisition aborts during pending write without creating lock file',
  {
    navigator: { locks: undefined }
  },
  async (t, ctx) => {
    const telemetry: TelemetrySnapshot = []
    const { sequence, unsubscribe } = collectLockSequence(telemetry)
    t.after(unsubscribe)

    const controller = new AbortController()
    let resolveWrite: (() => void) | undefined
    let notifyWriteStarted: (() => void) | undefined
    const writeStarted = new Promise<void>((resolve) => {
      notifyWriteStarted = resolve
    })

    const originalGetDirectory = ctx.opfs.storage.getDirectory
    const wrapDirectory = (
      directory: Awaited<ReturnType<typeof originalGetDirectory>>,
      prefix: string
    ): Awaited<ReturnType<typeof originalGetDirectory>> => {
      const getDirectoryHandle = directory.getDirectoryHandle.bind(directory)
      const getFileHandle = directory.getFileHandle.bind(directory)
      const removeEntry = directory.removeEntry.bind(directory)
      const entries = directory.entries.bind(directory)
      return {
        async getDirectoryHandle(name: string, options?: { create?: boolean }) {
          const next = await getDirectoryHandle(name, options as { create?: boolean })
          const nextPrefix = prefix ? `${prefix}/${name}` : name
          return wrapDirectory(next, nextPrefix)
        },
        async getFileHandle(name: string) {
          const handle = await getFileHandle(name)
          const filePath = prefix ? `${prefix}/${name}` : name
          if (filePath === FALLBACK_LOCK_PATH) {
            const createWritable = handle.createWritable.bind(handle)
            const getFile = handle.getFile.bind(handle)
            return {
              async createWritable() {
                const writable = await createWritable()
                const originalWrite = writable.write.bind(writable)
                const originalClose = writable.close.bind(writable)
                return {
                  async write(data: string) {
                    notifyWriteStarted?.()
                    await new Promise<void>((resolve) => {
                      resolveWrite = resolve
                    })
                    await originalWrite(data)
                  },
                  async close() {
                    await originalClose()
                  }
                }
              },
              async getFile() {
                return getFile()
              }
            }
          }
          return handle
        },
        async removeEntry(name: string) {
          return removeEntry(name)
        },
        async *entries() {
          for await (const entry of entries()) {
            yield entry
          }
        }
      }
    }

    ctx.opfs.storage.getDirectory = async () => wrapDirectory(await originalGetDirectory(), '')
    t.after(() => {
      ctx.opfs.storage.getDirectory = originalGetDirectory
    })

    const acquirePromise = projectLockApi.acquire({
      preferredStrategy: 'file-lock',
      signal: controller.signal,
      retry: false
    })

    await writeStarted

    const failTimer = setTimeout(() => {
      resolveWrite?.()
      assert.fail('acquireProjectLock must reject promptly after AbortSignal aborts fallback write')
    }, 100)

    controller.abort(new DOMException('User cancelled project lock acquire', 'AbortError'))

    let rejection: ProjectLockError | undefined
    try {
      await assert.rejects(acquirePromise, (error: unknown) => {
        assert.ok(error instanceof ProjectLockError, 'acquire must reject with ProjectLockError')
        rejection = error
        assert.equal(error.code, 'acquire-denied', 'error code must indicate acquisition denied')
        assert.equal(error.retryable, true, 'abort-triggered failure must remain retryable')
        return true
      })
    } finally {
      clearTimeout(failTimer)
      resolveWrite?.()
    }

    const error = rejection!

    assert.deepEqual(sequence, ['attempt:file-lock', 'error:acquire-denied:retryable=true'])
    assert.deepEqual(telemetry, [
      { type: 'lock:error', code: 'acquire-denied', retryable: true, operation: 'acquire' },
      { type: 'lock:readonly-entered', reason: 'acquire-failed', retryable: false }
    ])

    assert.equal(
      ctx.opfs.files.has('project/.lock'),
      false,
      'fallback lock file must not be created when acquisition aborts during pending write'
    )
  }
)

scenario(
  'AS-LK-13: Acquire abort aborts backoff wait without retrying additional strategies',
  {
    locks: {
      async request() {
        throw new DOMException('Lock already held', 'AbortError')
      }
    }
  },
  async (t, ctx) => {
    const fallbackRetryableFailure = new ProjectLockError('acquire-denied', 'Mock retryable fallback failure', {
      operation: 'acquire',
      retryable: true
    })
    const originalGetDirectory = ctx.opfs.storage.getDirectory
    const emptyEntries = async function* (): AsyncGenerator<readonly [string, Record<string, never>], void, unknown> {}
    const projectDir = {
      async getDirectoryHandle() {
        throw new Error('unexpected nested directory access')
      },
      async getFileHandle() {
        throw fallbackRetryableFailure
      },
      async removeEntry() {
        throw fallbackRetryableFailure
      },
      entries: emptyEntries
    }
    const rootDir = {
      async getDirectoryHandle(name: string) {
        if (name !== 'project') throw new Error(`unexpected directory ${name}`)
        return projectDir
      },
      async getFileHandle() {
        throw fallbackRetryableFailure
      },
      async removeEntry() {
        throw fallbackRetryableFailure
      },
      entries: emptyEntries
    }
    ctx.opfs.storage.getDirectory = async () =>
      rootDir as Awaited<ReturnType<typeof originalGetDirectory>>
    t.after(() => {
      ctx.opfs.storage.getDirectory = originalGetDirectory
    })

    const telemetry: TelemetrySnapshot = []
    const { sequence, unsubscribe } = collectLockSequence(telemetry)
    t.after(unsubscribe)

    let waitingEvent: { retry: number; delayMs: number } | undefined
    const waitingDetected = new Promise<void>((resolve) => {
      const unsubscribeWaiting = projectLockEvents.subscribe((event) => {
        if (event.type === 'lock:waiting') {
          waitingEvent = { retry: event.retry, delayMs: event.delayMs }
          unsubscribeWaiting()
          resolve()
        }
      })
      t.after(unsubscribeWaiting)
    })

    const controller = new AbortController()
    const acquirePromise = projectLockApi.acquire({ preferredStrategy: 'web-lock', signal: controller.signal })
    await waitingDetected
    controller.abort(new DOMException('User cancelled project lock acquire', 'AbortError'))

    const error = (await assert.rejects(acquirePromise)) as ProjectLockError
    assert.ok(error instanceof ProjectLockError, 'acquire must reject with ProjectLockError')
    assert.equal(error.code, 'acquire-denied', 'error code must indicate acquisition denied')
    assert.equal(error.retryable, false, 'abort during backoff must be treated as non-retryable')
    assert.deepEqual(waitingEvent, { retry: 1, delayMs: 500 })
    assert.deepEqual(
      sequence,
      [
        'attempt:web-lock',
        'error:acquire-denied:retryable=true',
        'attempt:file-lock',
        'error:acquire-denied:retryable=true',
        'error:acquire-denied:retryable=false'
      ],
      'acquire must not perform additional attempts after abort during backoff'
    )
    assert.deepEqual(telemetry, [
      { type: 'lock:error', code: 'acquire-denied', retryable: true, operation: 'acquire' },
      { type: 'lock:error', code: 'acquire-denied', retryable: true, operation: 'acquire' },
      { type: 'lock:error', code: 'acquire-denied', retryable: false, operation: 'acquire' },
      { type: 'lock:readonly-entered', reason: 'acquire-failed', retryable: false }
    ])
    assert.equal(ctx.opfs.files.has('project/.lock'), false, 'fallback lock file must not exist after abort')
  }
)

scenario(
  'AS-I-03: Expired fallback lock refreshes acquiredAt timestamp and telemetry',
  {
    locks: {
      async request() {
        throw new DOMException('Lock already held', 'AbortError')
      }
    }
  },
  async (t, { opfs }) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 60_000 })

    const staleRecord = {
      leaseId: 'stale-lease',
      ownerId: 'another-owner',
      acquiredAt: 1_000,
      expiresAt: 10_000,
      ttlSeconds: 30,
      mtime: 10_000
    }
    opfs.files.set('project/.lock', JSON.stringify(staleRecord))

    const uuids = ['fresh-lease', 'fresh-owner']
    t.mock.method(crypto, 'randomUUID', () => {
      const value = uuids.shift()
      if (!value) throw new Error('uuid exhausted')
      return value
    })

    const telemetry: TelemetrySnapshot = []
    const { sequence, unsubscribe } = collectLockSequence(telemetry)
    t.after(unsubscribe)

    const lease = await projectLockApi.acquire({ preferredStrategy: 'web-lock' })
    const acquisitionNow = Date.now()

    assert.equal(lease.strategy, 'file-lock')
    assert.equal(lease.viaFallback, true)
    assert.equal(lease.leaseId, 'fresh-lease')
    assert.equal(lease.ownerId, 'fresh-owner')
    assert.ok(
      Math.abs(lease.acquiredAt - acquisitionNow) <= 1,
      'acquiredAt must refresh to current time when a new fallback lease is created'
    )
    assert.notEqual(
      lease.acquiredAt,
      staleRecord.acquiredAt,
      'expired fallback lease timestamps must not leak into new leases'
    )

    const fallbackRecordRaw = opfs.files.get('project/.lock')
    assert.ok(fallbackRecordRaw, 'fallback record must exist after acquisition')
    const fallbackRecord = JSON.parse(fallbackRecordRaw)
    assert.equal(
      fallbackRecord.acquiredAt,
      lease.acquiredAt,
      'fallback record acquiredAt must align with the active lease'
    )

    await projectLockApi.release(lease)

    assert.deepEqual(sequence, [
      'attempt:web-lock',
      'error:acquire-denied:retryable=true',
      'attempt:file-lock',
      'warning:fallback-engaged',
      'fallback-engaged',
      'acquired:file-lock',
      'released'
    ])
    assert.deepEqual(telemetry, [
      { type: 'lock:error', code: 'acquire-denied', retryable: true, operation: 'acquire' }
    ])
  }
)

scenario(
  'AS-I-03: Expired fallback lock with reused leaseId refreshes acquiredAt timestamp',
  {
    locks: {
      async request() {
        throw new DOMException('Lock already held', 'AbortError')
      }
    }
  },
  async (t, { opfs }) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 120_000 })

    const expiredRecord = {
      leaseId: 'reused-lease',
      ownerId: 'stale-owner',
      acquiredAt: 2_000,
      expiresAt: 30_000,
      ttlSeconds: 30,
      mtime: 30_000
    }
    opfs.files.set('project/.lock', JSON.stringify(expiredRecord))

    const uuids = ['reused-lease', 'fresh-owner']
    t.mock.method(crypto, 'randomUUID', () => {
      const value = uuids.shift()
      if (!value) throw new Error('uuid exhausted')
      return value
    })

    const telemetry: TelemetrySnapshot = []
    const { sequence, unsubscribe } = collectLockSequence(telemetry)
    t.after(unsubscribe)

    const lease = await projectLockApi.acquire({ preferredStrategy: 'web-lock' })
    const acquisitionNow = Date.now()

    assert.equal(lease.strategy, 'file-lock')
    assert.equal(lease.viaFallback, true)
    assert.equal(lease.leaseId, 'reused-lease')
    assert.ok(
      Math.abs(lease.acquiredAt - acquisitionNow) <= 1,
      'acquiredAt must refresh to current time when fallback leaseId is reused after expiry'
    )
    assert.notEqual(
      lease.acquiredAt,
      expiredRecord.acquiredAt,
      'expired fallback lease timestamps must not persist when reusing the same leaseId'
    )

    const fallbackRecordRaw = opfs.files.get('project/.lock')
    assert.ok(fallbackRecordRaw, 'fallback record must exist after reacquisition')
    const fallbackRecord = JSON.parse(fallbackRecordRaw)
    assert.equal(
      fallbackRecord.acquiredAt,
      lease.acquiredAt,
      'fallback record acquiredAt must match refreshed lease timestamp when leaseId is reused'
    )

    await projectLockApi.release(lease)

    assert.deepEqual(sequence, [
      'attempt:web-lock',
      'error:acquire-denied:retryable=true',
      'attempt:file-lock',
      'warning:fallback-engaged',
      'fallback-engaged',
      'acquired:file-lock',
      'released'
    ])
    assert.deepEqual(telemetry, [
      { type: 'lock:error', code: 'acquire-denied', retryable: true, operation: 'acquire' }
    ])
  }
)

scenario(
  'AS-I-03: TTL override keeps fallback ttlSeconds metadata fixed',
  {
    locks: {
      async request() {
        throw new DOMException('Lock already held', 'AbortError')
      }
    }
  },
  async (t, { opfs }) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 180_000 })

    const uuids = ['override-lease', 'override-owner']
    t.mock.method(crypto, 'randomUUID', () => {
      const value = uuids.shift()
      if (!value) throw new Error('uuid exhausted')
      return value
    })

    const overrideTtlMs = 45_000
    const acquisitionNow = Date.now()
    const lease = await projectLockApi.acquire({ preferredStrategy: 'web-lock', ttlMs: overrideTtlMs })

    assert.equal(lease.strategy, 'file-lock')
    assert.equal(lease.ttlMillis, overrideTtlMs, 'lease ttlMillis must reflect override value')

    const fallbackRecordRaw = opfs.files.get('project/.lock')
    assert.ok(fallbackRecordRaw, 'fallback record must be written after acquisition')
    const fallbackRecord = JSON.parse(fallbackRecordRaw)

    assert.equal(
      fallbackRecord.ttlSeconds,
      FALLBACK_LOCK_TTL_MS / 1000,
      'ttlSeconds metadata must remain fixed regardless of override ttlMs'
    )

    assert.equal(
      fallbackRecord.expiresAt,
      acquisitionNow + overrideTtlMs,
      'expiresAt must continue to reflect the overridden ttlMs'
    )

    await projectLockApi.release(lease)
  }
)

scenario(
  'AS-I-03: Non-retryable Web Lock failure stops acquisition with telemetry',
  {
    locks: {
      async request(_key, _options, callback) {
        const invoke = callback as (lock: unknown) => Promise<unknown>
        await invoke({})
      }
    }
  },
  async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
    const uuids = ['lease-c', 'owner-c']
    t.mock.method(crypto, 'randomUUID', () => {
      const value = uuids.shift()
      if (!value) throw new Error('uuid exhausted')
      return value
    })

    const telemetry: TelemetrySnapshot = []
    const { sequence, unsubscribe } = collectLockSequence(telemetry)
    t.after(unsubscribe)

    await assert.rejects(async () => projectLockApi.acquire({ preferredStrategy: 'web-lock', retry: false }), (error: unknown) => {
      assert.ok(error instanceof ProjectLockError)
      assert.equal(error.retryable, false)
      return true
    })

    await assertSnapshot('locks-non-retryable', { lockSequence: sequence, telemetry })
  }
)

const createDeferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

scenario(
  'AS-I-03: Web Lock release resolves and emits released event',
  {
    locks: {
      async request(_key, optionsOrCallback, callback) {
        const handler = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback
        if (typeof handler !== 'function') throw new TypeError('Lock request callback missing')
        const released = createDeferred<void>()
        const handle = { async release() {}, released: released.promise }
        const result = await handler(handle)
        released.resolve()
        return result
      }
    }
  },
  async (t) => {
    const uuids = ['lease-release', 'owner-release']
    t.mock.method(crypto, 'randomUUID', () => {
      const value = uuids.shift()
      if (!value) throw new Error('uuid exhausted')
      return value
    })

    const events: ProjectLockEvent[] = []
    const unsubscribe = projectLockEvents.subscribe((event) => {
      events.push(event)
    })
    t.after(unsubscribe)

    const lease = await projectLockApi.acquire({ preferredStrategy: 'web-lock', retry: false })
    assert.equal(lease.strategy, 'web-lock')

    const releasePromise = projectLockApi.release(lease)
    const outcome = await Promise.race([
      releasePromise.then(() => 'released'),
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), 100)
      })
    ])
    assert.equal(outcome, 'released')
    await releasePromise

    const releasedEvent = events.find(
      (event): event is Extract<ProjectLockEvent, { type: 'lock:released' }> => event.type === 'lock:released'
    )
    if (!releasedEvent) {
      assert.fail('lock:released not emitted')
    }
    assert.equal(releasedEvent.leaseId, lease.leaseId)
  }
)

scenario(
  'AS-I-03: Web Lock release propagates request rejection after release',
  {
    locks: {
      async request(_key, optionsOrCallback, callback) {
        const handler = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback
        if (typeof handler !== 'function') throw new TypeError('Lock request callback missing')

        const released = createDeferred<void>()
        const handle: LockHandleLike & { released: Promise<void> } = {
          async release() {
            released.resolve()
          },
          released: released.promise,
        }

        await handler(handle)
        await released.promise
        throw new Error('request callback failed after release')
      }
    }
  },
  async (t) => {
    const uuids = ['lease-release-error', 'owner-release-error']
    t.mock.method(crypto, 'randomUUID', () => {
      const value = uuids.shift()
      if (!value) throw new Error('uuid exhausted')
      return value
    })

    const events: ProjectLockEvent[] = []
    const unsubscribe = projectLockEvents.subscribe((event) => {
      events.push(event)
    })
    t.after(unsubscribe)

    const lease = await projectLockApi.acquire({ preferredStrategy: 'web-lock', retry: false })

    await assert.rejects(projectLockApi.release(lease), (error: unknown) => {
      assert.ok(error instanceof ProjectLockError)
      assert.equal(error.code, 'release-failed')
      return true
    })

    assert.equal(
      events.some((event) => event.type === 'lock:released' && event.leaseId === lease.leaseId),
      false,
      'lock:released must not emit when release fails after request rejection',
    )
  }
)

scenario(
  'AS-LK-07: projectLockApi.release fails when navigator.locks.request rejects after release',
  {
    locks: {
      async request(_key, optionsOrCallback, callback) {
        const handler = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback
        if (typeof handler !== 'function') throw new TypeError('Lock request callback missing')

        const released = createDeferred<void>()
        const handle: LockHandleLike & { released: Promise<void> } = {
          async release() {
            released.resolve()
          },
          released: released.promise
        }

        await handler(handle)
        await released.promise
        throw new Error('navigator.locks.request rejected after release')
      }
    }
  },
  async (t) => {
    const uuids = ['lease-release-request-reject', 'owner-release-request-reject']
    t.mock.method(crypto, 'randomUUID', () => {
      const value = uuids.shift()
      if (!value) throw new Error('uuid exhausted')
      return value
    })

    const events: ProjectLockEvent[] = []
    const unsubscribe = projectLockEvents.subscribe((event) => {
      events.push(event)
    })
    t.after(unsubscribe)

    const lease = await projectLockApi.acquire({ preferredStrategy: 'web-lock', retry: false })

    await assert.rejects(projectLockApi.release(lease), (error: unknown) => {
      assert.ok(error instanceof ProjectLockError)
      assert.equal(error.code, 'release-failed')
      return true
    })

    assert.equal(
      events.some((event) => event.type === 'lock:released' && event.leaseId === lease.leaseId),
      false,
      'lock:released must not emit when navigator.locks.request rejects after release'
    )
  }
)

scenario(
  'AS-LK-08: projectLockApi.release fails when lock.released rejects',
  {
    locks: {
      async request(_key, optionsOrCallback, callback) {
        const handler = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback
        if (typeof handler !== 'function') throw new TypeError('Lock request callback missing')

        const releaseCalled = createDeferred<void>()
        const handle: LockHandleLike & { released: Promise<void> } = {
          async release() {
            releaseCalled.resolve()
          },
          released: releaseCalled.promise.then(() => {
            throw new Error('lock.released rejected')
          })
        }

        await handler(handle)
        await releaseCalled.promise
      }
    }
  },
  async (t) => {
    const uuids = ['lease-release-released-reject', 'owner-release-released-reject']
    t.mock.method(crypto, 'randomUUID', () => {
      const value = uuids.shift()
      if (!value) throw new Error('uuid exhausted')
      return value
    })

    const events: ProjectLockEvent[] = []
    const unsubscribe = projectLockEvents.subscribe((event) => {
      events.push(event)
    })
    t.after(unsubscribe)

    const lease = await projectLockApi.acquire({ preferredStrategy: 'web-lock', retry: false })

    await assert.rejects(projectLockApi.release(lease), (error: unknown) => {
      assert.ok(error instanceof ProjectLockError)
      assert.equal(error.code, 'release-failed')
      return true
    })

    assert.equal(
      events.some((event) => event.type === 'lock:released' && event.leaseId === lease.leaseId),
      false,
      'lock:released must not emit when lock.released rejects'
    )
  }
)

scenario(
  'AS-LK-08b: releaseProjectLock retries rethrow lock.released rejection without lock:released',
  {
    locks: {
      async request(_key, optionsOrCallback, callback) {
        const handler = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback
        if (typeof handler !== 'function') throw new TypeError('Lock request callback missing')

        const releaseCalled = createDeferred<void>()
        const handle: LockHandleLike & { released: Promise<void> } = {
          async release() {
            releaseCalled.resolve()
          },
          released: releaseCalled.promise.then(() => {
            throw new Error('lock.released rejected')
          })
        }

        await handler(handle)
        await releaseCalled.promise
      }
    }
  },
  async (t) => {
    const uuids = ['lease-release-released-reject', 'owner-release-released-reject']
    t.mock.method(crypto, 'randomUUID', () => {
      const value = uuids.shift()
      if (!value) throw new Error('uuid exhausted')
      return value
    })

    const events: ProjectLockEvent[] = []
    const unsubscribe = projectLockEvents.subscribe((event) => {
      events.push(event)
    })
    t.after(unsubscribe)

    const lease = await acquireProjectLock({ preferredStrategy: 'web-lock', retry: false })

    const firstError = await assert.rejects(async () => releaseProjectLock(lease))
    assert.ok(firstError instanceof ProjectLockError)
    assert.equal(firstError.code, 'release-failed')

    const secondError = await assert.rejects(async () => releaseProjectLock(lease))
    assert.strictEqual(secondError, firstError)

    const releasedEvents = events.filter(
      (event): event is Extract<ProjectLockEvent, { type: 'lock:released' }> => event.type === 'lock:released'
    )
    assert.equal(
      releasedEvents.length,
      0,
      'lock:released must not emit when releaseProjectLock is retried after lock.released rejection'
    )
  }
)

scenario(
  'AS-LK-09: Web Lock release rejection demotes to readonly without lock:released',
  {
    locks: {
      async request(_key, optionsOrCallback, callback) {
        const handler = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback
        if (typeof handler !== 'function') throw new TypeError('Lock request callback missing')

        const handle: LockHandleLike & { released: Promise<void> } = {
          async release() {
            throw new DOMException('Release denied', 'InvalidStateError')
          },
          released: Promise.resolve()
        }

        return handler(handle)
      }
    }
  },
  async (t) => {
    const uuids = ['lease-release-reject', 'owner-release-reject']
    t.mock.method(crypto, 'randomUUID', () => {
      const value = uuids.shift()
      if (!value) throw new Error('uuid exhausted')
      return value
    })

    const events: ProjectLockEvent[] = []
    const unsubscribe = projectLockEvents.subscribe((event) => {
      events.push(event)
    })
    t.after(unsubscribe)

    const lease = await projectLockApi.acquire({ preferredStrategy: 'web-lock', retry: false })

    const firstError = await assert.rejects(async () => projectLockApi.release(lease))
    assert.ok(firstError instanceof ProjectLockError)
    assert.equal(firstError.code, 'release-failed')
    assert.equal(firstError.retryable, true)

    const secondError = await assert.rejects(async () => projectLockApi.release(lease))
    assert.strictEqual(secondError, firstError)

    assert.equal(
      events.some((event) => event.type === 'lock:released' && event.leaseId === lease.leaseId),
      false,
      'lock:released must not emit when release is rejected'
    )

    const readonlyEvent = events.find(
      (event): event is Extract<ProjectLockEvent, { type: 'lock:readonly-entered' }> => event.type === 'lock:readonly-entered'
    )
    if (!readonlyEvent) {
      assert.fail('lock:readonly-entered not emitted after release rejection')
    }
    assert.equal(readonlyEvent.reason, 'release-failed')
    assert.equal(readonlyEvent.retryable, false)

    const errorEvent = events.find(
      (event): event is Extract<ProjectLockEvent, { type: 'lock:error' }> => event.type === 'lock:error'
    )
    if (!errorEvent) {
      assert.fail('lock:error not emitted after release rejection')
    }
    assert.equal(errorEvent.retryable, true)
    assert.equal(errorEvent.error.code, 'release-failed')
  }
)

test('AS-LK-09c: releaseProjectLock failure remains retryable across retries', async (t) => {
  const events: ProjectLockEvent[] = []
  const unsubscribe = projectLockEvents.subscribe((event) => {
    events.push(event)
  })
  t.after(unsubscribe)

  const releaseMock = t.mock.fn(async () => {
    throw new DOMException('Release denied', 'InvalidStateError')
  })

  const request = t.mock.fn((...args: unknown[]) => {
    assert.equal(args.length, 3, 'navigator.locks.request must receive key, options, and callback')
    const [key, options, callback] = args as [
      string,
      { mode: 'exclusive'; signal?: AbortSignal },
      (lock: { release: () => Promise<void>; released: Promise<void> }) => Promise<unknown>
    ]
    assert.equal(key, WEB_LOCK_KEY)
    assert.equal(options.mode, 'exclusive')
    const handle = {
      release: releaseMock,
      released: Promise.resolve()
    }
    const callbackResult = Promise.resolve(callback(handle))
    return callbackResult
  })

  const originalNavigator = (globalThis as typeof globalThis & { navigator?: unknown }).navigator
  Object.defineProperty(globalThis, 'navigator', {
    value: { locks: { request } },
    configurable: true
  })
  t.after(() => {
    if (originalNavigator === undefined) {
      delete (globalThis as { navigator?: unknown }).navigator
    } else {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true })
    }
  })

  const uuids = ['lease-release-retryable', 'owner-release-retryable']
  t.mock.method(crypto, 'randomUUID', () => {
    const value = uuids.shift()
    if (!value) throw new Error('uuid exhausted')
    return value
  })

  const lease = await acquireProjectLock({ preferredStrategy: 'web-lock', retry: false })

  const firstError = await assert.rejects(async () => releaseProjectLock(lease))
  assert.ok(firstError instanceof ProjectLockError)
  assert.equal(firstError.code, 'release-failed')
  assert.equal(firstError.retryable, true)

  const secondError = await assert.rejects(async () => releaseProjectLock(lease))
  assert.strictEqual(secondError, firstError)

  const releasedEvents = events.filter(
    (event): event is Extract<ProjectLockEvent, { type: 'lock:released' }> => event.type === 'lock:released'
  )
  assert.equal(releasedEvents.length, 0, 'lock:released must not emit when release fails')

  const errorEvent = events.find(
    (event): event is Extract<ProjectLockEvent, { type: 'lock:error' }> => event.type === 'lock:error'
  )
  if (!errorEvent) {
    assert.fail('lock:error not emitted after release failure')
  }
  assert.equal(errorEvent.operation, 'release')
  assert.equal(errorEvent.retryable, true)
  assert.equal(errorEvent.error.code, 'release-failed')

  const readonlyEvent = events.find(
    (event): event is Extract<ProjectLockEvent, { type: 'lock:readonly-entered' }> => event.type === 'lock:readonly-entered'
  )
  if (!readonlyEvent) {
    assert.fail('lock:readonly-entered not emitted after release failure')
  }
  assert.equal(readonlyEvent.reason, 'release-failed')
  assert.equal(readonlyEvent.retryable, false)
})

scenario(
  'AS-I-03: Web Lock handle without release resolves via released promise',
  {
    locks: {
      async request(_key, optionsOrCallback, callback) {
        const handler = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback
        if (typeof handler !== 'function') throw new TypeError('Lock request callback missing')

        let resolveReleased: (() => void) | undefined
        let releasedResolved = false
        const released = new Promise<void>((resolve) => {
          resolveReleased = () => {
            if (releasedResolved) return
            releasedResolved = true
            resolve()
          }
        })

        const result = await handler({ released } as unknown as LockHandleLike & { released: Promise<void> })
        resolveReleased?.()
        return result
      }
    }
  },
  async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
    const uuids = ['lease-h', 'owner-h']
    t.mock.method(crypto, 'randomUUID', () => {
      const value = uuids.shift()
      if (!value) throw new Error('uuid exhausted')
      return value
    })

    const telemetry: TelemetrySnapshot = []
    const { sequence, unsubscribe } = collectLockSequence(telemetry)
    t.after(unsubscribe)

    const lease = await projectLockApi.acquire({ preferredStrategy: 'web-lock' })
    const telemetryBeforeRelease = telemetry.slice()
    try {
      await projectLockApi.release(lease)
    } catch (error) {
      if (error instanceof ProjectLockError && error.code === 'release-failed') {
        assert.fail('projectLockApi.release must not throw release-failed when released promise resolves')
      }
      throw error
    }
    assert.deepEqual(
      telemetry,
      telemetryBeforeRelease,
      'Collector telemetry must remain intact after projectLockApi.release'
    )

    await assertSnapshot('locks-handle-without-release', { lockSequence: sequence, telemetry })
  }
)

scenario(
  'AS-LK-04: Web Lock release emits lock:released without readonly downgrade',
  {
    locks: {
      async request(_key, optionsOrCallback, callback) {
        const handler = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback
        if (typeof handler !== 'function') throw new TypeError('Lock request callback missing')

        let releasedResolved = false
        let resolveReleased!: () => void
        const released = new Promise<void>((resolve) => {
          resolveReleased = () => {
            if (releasedResolved) return
            releasedResolved = true
            resolve()
          }
        })

        const release = async () => {
          resolveReleased()
        }

        const result = await handler({ release, released } as unknown as LockHandleLike & { released: Promise<void> })
        resolveReleased()
        return result
      }
    }
  },
  async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
    const uuids = ['lease-release', 'owner-release']
    t.mock.method(crypto, 'randomUUID', () => {
      const value = uuids.shift()
      if (!value) throw new Error('uuid exhausted')
      return value
    })

    const events: ProjectLockEvent[] = []
    const unsubscribeEvents = projectLockEvents.subscribe((event) => {
      events.push(event)
    })
    t.after(unsubscribeEvents)

    const telemetry: TelemetrySnapshot = []
    const { sequence, unsubscribe } = collectLockSequence(telemetry)
    t.after(unsubscribe)

    const lease = await acquireProjectLock({ preferredStrategy: 'web-lock', retry: false })
    await releaseProjectLock(lease)

    const releasedEvents = events.filter((event): event is Extract<ProjectLockEvent, { type: 'lock:released' }> => event.type === 'lock:released')
    assert.equal(releasedEvents.length, 1)
    assert.equal(releasedEvents[0].leaseId, lease.leaseId)

    const readonlyEvents = events.filter((event) => event.type === 'lock:readonly-entered')
    assert.equal(readonlyEvents.length, 0)

    await assertSnapshot('locks-handle-without-release', { lockSequence: sequence, telemetry })
  }
)

test('AS-LK-05: acquireProjectLock/releaseProjectLock emits lock:released after Web Lock released', async (t) => {
  const events: ProjectLockEvent[] = []
  const unsubscribe = projectLockEvents.subscribe((event) => {
    events.push(event)
  })
  t.after(unsubscribe)

  const releaseGate = createDeferred<void>()
  const releasedDeferred = createDeferred<void>()

  const releaseMock = t.mock.fn(async () => {
    releaseGate.resolve()
    await releasedDeferred.promise
  })

  const request = t.mock.fn((...args: unknown[]) => {
    assert.equal(args.length, 3, 'navigator.locks.request must receive key, options, and callback')
    const [key, options, callback] = args as [
      string,
      { mode: 'exclusive'; signal?: AbortSignal },
      (lock: { release: () => Promise<void>; released: Promise<void> }) => Promise<unknown>
    ]
    assert.equal(key, WEB_LOCK_KEY)
    assert.equal(options.mode, 'exclusive')
    const handle = {
      release: releaseMock,
      released: releasedDeferred.promise
    }
    const callbackResult = Promise.resolve(callback(handle))
    return callbackResult
  })

  const originalNavigator = (globalThis as typeof globalThis & { navigator?: unknown }).navigator
  Object.defineProperty(globalThis, 'navigator', {
    value: { locks: { request } },
    configurable: true
  })
  t.after(() => {
    if (originalNavigator === undefined) {
      delete (globalThis as { navigator?: unknown }).navigator
    } else {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true })
    }
  })

  const lease = await acquireProjectLock({ preferredStrategy: 'web-lock', retry: false })
  assert.equal(lease.strategy, 'web-lock')

  const releasePromise = releaseProjectLock(lease)

  await releaseGate.promise
  assert.equal(releaseMock.mock.calls.length, 1, 'lock.release must be invoked exactly once')

  const releaseState = await Promise.race([
    releasePromise.then(() => 'resolved' as const),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 0))
  ])
  assert.equal(releaseState, 'pending', 'releaseProjectLock must wait for Web Lock released promise')

  releasedDeferred.resolve()
  await releasePromise

  assert.equal(
    events.filter((event): event is Extract<ProjectLockEvent, { type: 'lock:released' }> => event.type === 'lock:released').length,
    1,
    'lock:released must emit exactly once'
  )
  assert.equal(
    events.some((event) => event.type === 'lock:readonly-entered'),
    false,
    'lock:readonly-entered must not fire on successful release'
  )
})

test('AS-LK-06: releaseProjectLock completes Web Lock release without ProjectLockError', async (t) => {
  const events: ProjectLockEvent[] = []
  const unsubscribe = projectLockEvents.subscribe((event) => {
    events.push(event)
  })
  t.after(unsubscribe)

  const releaseDeferred = createDeferred<void>()
  const releasedDeferred = createDeferred<void>()
  const requestSettled = createDeferred<void>()

  const releaseMock = t.mock.fn(async () => {
    releaseDeferred.resolve()
    await releasedDeferred.promise
  })

  const request = t.mock.fn(async (...args: unknown[]) => {
    assert.equal(args.length, 3, 'navigator.locks.request must receive key, options, and callback')
    const [key, options, callback] = args as [
      string,
      { mode: 'exclusive'; signal?: AbortSignal },
      (lock: { release: () => Promise<void>; released: Promise<void> }) => Promise<unknown>
    ]
    assert.equal(key, WEB_LOCK_KEY)
    assert.equal(options.mode, 'exclusive')
    const lock = { release: releaseMock, released: releasedDeferred.promise }
    const callbackResult = Promise.resolve(callback(lock))
    callbackResult.then(() => requestSettled.resolve(), requestSettled.reject)
    return callbackResult
  })

  const originalNavigator = (globalThis as typeof globalThis & { navigator?: unknown }).navigator
  Object.defineProperty(globalThis, 'navigator', {
    value: { locks: { request } },
    configurable: true
  })
  t.after(() => {
    if (originalNavigator === undefined) {
      delete (globalThis as { navigator?: unknown }).navigator
    } else {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true })
    }
  })

  const lease = await acquireProjectLock({ preferredStrategy: 'web-lock', retry: false })
  assert.equal(lease.strategy, 'web-lock')

  const releasePromise = releaseProjectLock(lease)

  await releaseDeferred.promise
  releasedDeferred.resolve()
  await releasePromise
  await requestSettled.promise

  assert.equal(
    events.filter((event): event is Extract<ProjectLockEvent, { type: 'lock:released' }> => event.type === 'lock:released').length,
    1,
    'lock:released must fire exactly once'
  )
  assert.equal(
    events.some((event) => event.type === 'lock:error'),
    false,
    'lock:error must not fire during successful release'
  )
  assert.equal(
    events.some((event) => event.type === 'lock:readonly-entered'),
    false,
    'lock:readonly-entered must not fire during successful release'
  )
})

test('AS-LK-03: Web Lock は release() まで request が解決せず、lock.released 完了まで待機する', async (t) => {
  const events: ProjectLockEvent[] = []
  const unsubscribe = projectLockEvents.subscribe((event) => {
    events.push(event)
  })
  t.after(unsubscribe)

  let requestSettled = false
  let callbackSettled = false
  const releaseMock = t.mock.fn(async () => undefined)
  let resolveLockReleased!: () => void
  const lockReleased = new Promise<void>((resolve) => {
    resolveLockReleased = () => {
      resolve()
    }
  })

  const request = t.mock.fn((...args: unknown[]) => {
    assert.equal(args.length, 3, 'navigator.locks.request must receive key, options, and callback')
    const [key, options, callback] = args as [
      string,
      { mode: 'exclusive'; signal?: AbortSignal },
      (lock: { release: () => Promise<void>; released: Promise<void> }) => Promise<unknown>
    ]
    assert.equal(key, WEB_LOCK_KEY)
    assert.equal(options.mode, 'exclusive')
    const lock = { release: releaseMock, released: lockReleased }
    const callbackResult = Promise.resolve(callback(lock))
    callbackResult.then(() => {
      callbackSettled = true
    })
    const requestResult = callbackResult.then(() => {
      requestSettled = true
    })
    return requestResult
  })

  const originalNavigator = (globalThis as typeof globalThis & { navigator?: unknown }).navigator
  Object.defineProperty(globalThis, 'navigator', {
    value: { locks: { request } },
    configurable: true
  })
  t.after(() => {
    if (originalNavigator === undefined) {
      delete (globalThis as { navigator?: unknown }).navigator
    } else {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true })
    }
  })

  const lease = await acquireProjectLock()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(requestSettled, false, 'navigator.locks.request must remain pending before release')
  assert.equal(callbackSettled, false, 'Web Lock callback must remain pending before release')
  assert.equal(releaseMock.mock.calls.length, 0, 'lock.release must not be called before releaseProjectLock')

  const releasePromise = releaseProjectLock(lease)

  assert.equal(
    events.some((event) => event.type === 'lock:release-requested' && event.lease.leaseId === lease.leaseId),
    true,
    'lock:release-requested event must be emitted when release starts'
  )

  const releaseState = await Promise.race<"resolved" | "pending">([
    releasePromise.then(() => 'resolved'),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 10))
  ])
  assert.equal(releaseState, 'pending', 'releaseProjectLock must wait for lock.released to settle')

  assert.equal(requestSettled, true, 'navigator.locks.request should resolve once release begins')
  assert.equal(callbackSettled, true, 'Web Lock callback should resolve once release begins')
  assert.equal(releaseMock.mock.calls.length, 1, 'lock.release must be called exactly once during release')

  resolveLockReleased()
  await releasePromise

  assert.equal(requestSettled, true, 'navigator.locks.request should resolve after lock.released settles')
  assert.equal(callbackSettled, true, 'Web Lock callback should resolve after lock.released settles')

  assert.equal(
    events.filter((event) => event.type === 'lock:release-requested' && event.lease.leaseId === lease.leaseId).length,
    1,
    'lock:release-requested should be emitted exactly once'
  )
  assert.equal(
    events.some((event) => event.type === 'lock:released' && event.leaseId === lease.leaseId),
    true,
    'lock:released event must be emitted after lock.released resolves'
  )
  assert.equal(
    events.some((event) => event.type === 'lock:fallback-engaged'),
    false,
    'fallback events must not fire for Web Lock strategy'
  )
  assert.equal(releaseMock.mock.calls.length, 1, 'lock.release must be called exactly once overall')
})
