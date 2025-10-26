import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  WEB_LOCK_KEY,
  acquireProjectLock,
  projectLockEvents,
  releaseProjectLock,
  type ProjectLockEvent
} from '../../src/lib/locks'
import { createOpfs } from '../lib/autosave/setup'

const SNAPSHOT_ROOT = fileURLToPath(new URL('./__snapshots__/autosave/', import.meta.url))
const UPDATE_SNAPSHOTS =
  process.argv.includes('--update-snapshots') || process.env.UPDATE_SNAPSHOTS === '1'

const ensureDir = (file: string) => {
  const dir = dirname(file)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

const writeSnapshot = (relativePath: string, value: unknown) => {
  const file = join(SNAPSHOT_ROOT, relativePath)
  ensureDir(file)
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const readSnapshot = (relativePath: string): unknown => {
  const file = join(SNAPSHOT_ROOT, relativePath)
  return JSON.parse(readFileSync(file, 'utf8'))
}

const matchSnapshot = (relativePath: string, value: unknown) => {
  if (UPDATE_SNAPSHOTS) {
    writeSnapshot(relativePath, value)
    return
  }
  const expected = readSnapshot(relativePath)
  assert.deepEqual(value, expected)
}

type LockSequenceEntry = 'web:acquire' | 'web:fail' | 'file:acquire' | 'release'

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

test('AS-I-03: Web Lock 失敗で fallback を使用し retryable 分岐を維持する', async (t) => {
  const opfs = createOpfs()
  const request = t.mock.fn(async () => {
    throw Object.assign(new Error('Lock denied'), { name: 'NotAllowedError' as const })
  })

  const originalNavigator = (globalThis as typeof globalThis & { navigator?: unknown }).navigator
  Object.defineProperty(globalThis, 'navigator', {
    value: { locks: { request }, storage: opfs.storage },
    configurable: true
  })
  t.after(() => {
    if (originalNavigator === undefined) {
      delete (globalThis as { navigator?: unknown }).navigator
    } else {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true })
    }
  })

  const uuids = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004'
  ]
  const uuidMock = t.mock.method(globalThis.crypto, 'randomUUID', () => uuids.shift() ?? '00000000-0000-4000-8000-ffffffffffff')
  t.after(() => uuidMock.mock.restore())

  const sequence: LockSequenceEntry[] = []
  const errors: { retryable: boolean; code: string }[] = []
  const unsubscribe = projectLockEvents.subscribe((event) => {
    switch (event.type) {
      case 'lock:attempt':
        sequence.push(event.strategy === 'web-lock' ? 'web:acquire' : 'file:acquire')
        break
      case 'lock:error':
        if (event.operation === 'acquire') {
          sequence.push('web:fail')
          errors.push({ retryable: event.retryable, code: event.error.code })
        }
        break
      case 'lock:released':
        sequence.push('release')
        break
      default:
        break
    }
  })
  t.after(unsubscribe)

  const lease = await acquireProjectLock()
  assert.equal(lease.strategy, 'file-lock')
  assert.equal(lease.viaFallback, true)
  assert.ok(request.mock.calls.length >= 1, 'Web Lock request must be attempted before fallback')
  assert.ok(errors.every((entry) => entry.retryable), 'lock:error events should remain retryable')

  await releaseProjectLock(lease)
  assert.equal(opfs.files.has('project/.lock'), false)

  matchSnapshot('on/as-i-03.fallback.lock-sequence.json', sequence)
})

test('AS-I-03: fallback 衝突が継続すると readonly へ降格し Collector 通知要件を満たす', async (t) => {
  const opfs = createOpfs()
  const now = Date.now()

  const originalNavigator = (globalThis as typeof globalThis & { navigator?: unknown }).navigator
  Object.defineProperty(globalThis, 'navigator', {
    value: { storage: opfs.storage },
    configurable: true
  })
  t.after(() => {
    if (originalNavigator === undefined) {
      delete (globalThis as { navigator?: unknown }).navigator
    } else {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true })
    }
  })

  const uuidValues = [
    '00000000-0000-4000-8000-000000000010',
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000012'
  ]
  const uuidMock = t.mock.method(globalThis.crypto, 'randomUUID', () => uuidValues.shift() ?? '00000000-0000-4000-8000-ffffffffffff')
  t.after(() => uuidMock.mock.restore())

  const existingRecord = {
    leaseId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    ownerId: 'conflict-owner',
    acquiredAt: now - 5_000,
    expiresAt: now + 30_000,
    ttlSeconds: 30,
    mtime: now
  }
  opfs.files.set('project/.lock', JSON.stringify(existingRecord))

  const sequence: LockSequenceEntry[] = []
  let readonlyEntered = false
  const unsubscribe = projectLockEvents.subscribe((event) => {
    switch (event.type) {
      case 'lock:attempt':
        sequence.push(event.strategy === 'web-lock' ? 'web:acquire' : 'file:acquire')
        break
      case 'lock:readonly-entered':
        readonlyEntered = true
        assert.equal(event.retryable, false)
        assert.equal(event.reason, 'acquire-failed')
        break
      default:
        break
    }
  })
  t.after(unsubscribe)

  await acquireProjectLock({
    preferredStrategy: 'file-lock',
    backoff: { initialDelayMs: 0, factor: 1, maxAttempts: 2 }
  })
    .then(() => assert.fail('acquireProjectLock should reject when fallback conflicts persist'))
    .catch((error) => {
      assert.equal(error instanceof Error, true)
      assert.equal('code' in error ? (error as { code?: unknown }).code : undefined, 'fallback-conflict')
      assert.equal('retryable' in error ? (error as { retryable?: unknown }).retryable : undefined, true)
    })

  assert.equal(readonlyEntered, true, 'lock:readonly-entered event must fire when retries exhaust')
  matchSnapshot('on/as-i-03.conflict.lock-sequence.json', sequence)
})
