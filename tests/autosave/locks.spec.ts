import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  WEB_LOCK_KEY,
  acquireProjectLock,
  projectLockEvents,
  releaseProjectLock,
  type ProjectLockEvent
} from '../../src/lib/locks'

test('AS-LK-01: navigator.locks.request は常にコールバック経由で Web Lock を取得する', async (t) => {
  const events: ProjectLockEvent[] = []
  const unsubscribe = projectLockEvents.subscribe((event) => {
    events.push(event)
  })
  t.after(unsubscribe)

  const releaseMock = t.mock.fn(async () => undefined)
  const request = t.mock.fn(async (...args: unknown[]) => {
    assert.equal(args.length, 3, 'navigator.locks.request must receive key, options, and callback')
    const [key, options, callback] = args as [
      string,
      { mode: 'exclusive'; signal?: AbortSignal },
      (lock: { release: () => Promise<void> }) => Promise<void> | void
    ]
    assert.equal(key, WEB_LOCK_KEY)
    assert.equal(options.mode, 'exclusive')
    const lock = { release: releaseMock }
    await callback(lock)
    return undefined
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
  assert.equal(request.mock.calls.length, 1)
  assert.equal((request.mock.calls[0]?.arguments ?? []).length, 3)
  assert.equal(
    events.some((event) => event.type === 'lock:acquired' && event.lease.leaseId === lease.leaseId),
    true
  )
  assert.equal(events.some((event) => event.type === 'lock:fallback-engaged'), false)
  assert.equal(lease.strategy, 'web-lock')
  assert.equal(lease.viaFallback, false)

  await releaseProjectLock(lease)
  assert.equal(releaseMock.mock.calls.length, 1)
})

test('AS-LK-02: Web Lock 成功時に lock:acquired が発火し fallback は抑止される', async (t) => {
  const events: ProjectLockEvent[] = []
  const unsubscribe = projectLockEvents.subscribe((event) => {
    events.push(event)
  })
  t.after(unsubscribe)

  const releaseMock = t.mock.fn(async () => undefined)
  const request = t.mock.fn((...args: unknown[]) => {
    assert.equal(args.length, 3, 'navigator.locks.request must receive key, options, and callback')
    const [key, options, callback] = args as [
      string,
      { mode: 'exclusive'; signal?: AbortSignal },
      (lock: { release: () => Promise<void> }) => Promise<unknown>
    ]
    assert.equal(key, WEB_LOCK_KEY)
    assert.equal(options.mode, 'exclusive')
    const result = callback({ release: releaseMock })
    assert.ok(result instanceof Promise, 'callback must return a Promise to hold the Web Lock')
    return result
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

  const lease = await Promise.race([
    acquireProjectLock(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('acquire timeout')), 50))
  ])

  assert.equal(request.mock.calls.length, 1)
  assert.equal(lease.strategy, 'web-lock')
  assert.equal(lease.viaFallback, false)
  assert.equal(
    events.some((event) => event.type === 'lock:acquired' && event.lease.leaseId === lease.leaseId),
    true,
    'lock:acquired event should fire with the acquired lease'
  )
  assert.equal(
    events.some((event) => event.type === 'lock:fallback-engaged'),
    false,
    'lock:fallback-engaged must not fire when Web Lock succeeds'
  )

  await releaseProjectLock(lease)
  assert.equal(releaseMock.mock.calls.length, 1)
  assert.equal(
    events.some((event) => event.type === 'lock:released' && event.leaseId === lease.leaseId),
    true,
    'lock:released event should fire once the lease is released'
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
    events.some((event) => event.type === 'lock:release-requested' && event.leaseId === lease.leaseId),
    true,
    'lock:release-requested event must be emitted when release starts'
  )

  const releaseState = await Promise.race<"resolved" | "pending">([
    releasePromise.then(() => 'resolved'),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 10))
  ])
  assert.equal(releaseState, 'pending', 'releaseProjectLock must wait for lock.released to settle')

  assert.equal(requestSettled, true, 'navigator.locks.request should resolve once release is invoked')
  assert.equal(callbackSettled, true, 'Web Lock callback should resolve once release is invoked')
  assert.equal(releaseMock.mock.calls.length, 1, 'lock.release must be called exactly once during release')

  resolveLockReleased()
  await releasePromise

  assert.equal(
    events.filter((event) => event.type === 'lock:release-requested' && event.leaseId === lease.leaseId).length,
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
})
