/// <reference types="node" />

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  acquireProjectLock,
  releaseProjectLock,
  projectLockEvents,
  WEB_LOCK_KEY,
  type ProjectLockEvent
} from '../../src/lib/locks'
import { ProjectLockError, projectLockApi } from '../../src/lib/locks'
import { scenario } from '../lib/autosave/setup'

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
    await projectLockApi.release(lease)

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
    await projectLockApi.release(lease)

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
