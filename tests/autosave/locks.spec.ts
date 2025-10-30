/// <reference types="node" />

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import type { TestContext } from 'node:test'

import {
  acquireProjectLock,
  renewProjectLock,
  releaseProjectLock,
  projectLockEvents,
  WEB_LOCK_KEY,
  FALLBACK_LOCK_PATH,
  FALLBACK_LOCK_TTL_MS,
  WEB_LOCK_TTL_MS,
  ProjectLockError,
  projectLockApi,
  type ProjectLockEvent,
  type ProjectLockLease
} from '../../src/lib/locks'
import { AUTOSAVE_RETRY_POLICY } from '../../src/lib/autosave'
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

scenario('AS-HB-01: Heartbeat interval customization is honoured', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  const heartbeatMs = 6_500
  const uuids = ['lease-heartbeat', 'owner-heartbeat']
  t.mock.method(crypto, 'randomUUID', () => {
    const value = uuids.shift()
    if (!value) throw new Error('uuid exhausted')
    return value
  })

  const scheduled: Array<{ at: number; nextIn: number; renewAttempt: number }> = []
  const renewed: Array<{ at: number; lease: ProjectLockLease }> = []
  const unsubscribe = projectLockEvents.subscribe((event) => {
    switch (event.type) {
      case 'lock:renew-scheduled':
        scheduled.push({
          at: Date.now(),
          nextIn: event.nextHeartbeatInMs,
          renewAttempt: event.lease.renewAttempt,
        })
        break
      case 'lock:renewed':
        renewed.push({ at: Date.now(), lease: event.lease })
        break
      default:
        break
    }
  })
  t.after(unsubscribe)

  const lease = await acquireProjectLock({ preferredStrategy: 'file-lock', heartbeatIntervalMs: heartbeatMs })

  const initialSchedule = scheduled.find((record) => record.renewAttempt === 0)
  assert.ok(initialSchedule, 'initial heartbeat schedule must be recorded')
  assert.equal(initialSchedule.nextIn, heartbeatMs)

  t.mock.timers.tick(heartbeatMs)
  const refreshed = await projectLockApi.renew(lease)

  const renewedEvent = renewed.find((record) => record.lease.renewAttempt === refreshed.renewAttempt)
  assert.ok(renewedEvent, 'renewed event must be captured')
  assert.equal(refreshed.nextHeartbeatAt - Date.now(), heartbeatMs)
  assert.equal(renewedEvent.lease.nextHeartbeatAt - Date.now(), heartbeatMs)

  const nextSchedule = scheduled.at(-1)
  assert.ok(nextSchedule, 'subsequent heartbeat schedule must be recorded')
  assert.equal(nextSchedule?.renewAttempt, refreshed.renewAttempt)
  assert.equal(nextSchedule?.nextIn, heartbeatMs)

  await releaseProjectLock(refreshed)
})

scenario('AS-HB-02: Renew infers heartbeat interval when lease omits heartbeatIntervalMs', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  const heartbeatMs = 7_200
  const uuids = ['lease-heartbeat-missing', 'owner-heartbeat-missing']
  t.mock.method(crypto, 'randomUUID', () => {
    const value = uuids.shift()
    if (!value) throw new Error('uuid exhausted')
    return value
  })

  const renewals: ProjectLockLease[] = []
  const unsubscribe = projectLockEvents.subscribe((event) => {
    if (event.type === 'lock:renewed') {
      renewals.push(event.lease)
    }
  })
  t.after(unsubscribe)

  const lease = await acquireProjectLock({ preferredStrategy: 'file-lock', heartbeatIntervalMs: heartbeatMs })
  const expectedInterval = lease.heartbeatIntervalMs
  const legacyLease = { ...lease, heartbeatIntervalMs: 0 } as ProjectLockLease

  t.mock.timers.tick(Math.max(0, lease.nextHeartbeatAt - Date.now()))
  const refreshed = await renewProjectLock(legacyLease)

  assert.equal(refreshed.heartbeatIntervalMs, expectedInterval)
  assert.equal(refreshed.nextHeartbeatAt - Date.now(), expectedInterval)

  const renewedLease = renewals.at(-1)
  assert.ok(renewedLease, 'renewed lease event must be captured')
  assert.equal(renewedLease?.heartbeatIntervalMs, expectedInterval)
  assert.equal((renewedLease?.nextHeartbeatAt ?? 0) - Date.now(), expectedInterval)

  await releaseProjectLock(refreshed)
})

scenario('AS-HB-03: Heartbeat schedule is clipped by ttl when shorter than interval', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  const ttlMs = 4_000
  const heartbeatMs = 10_000
  const uuids = ['lease-heartbeat-ttl', 'owner-heartbeat-ttl']
  t.mock.method(crypto, 'randomUUID', () => {
    const value = uuids.shift()
    if (!value) throw new Error('uuid exhausted')
    return value
  })

  const scheduled: Array<{ lease: ProjectLockLease; nextIn: number }> = []
  const unsubscribe = projectLockEvents.subscribe((event) => {
    if (event.type === 'lock:renew-scheduled') {
      scheduled.push({ lease: event.lease, nextIn: event.nextHeartbeatInMs })
    }
  })
  t.after(unsubscribe)

  const lease = await acquireProjectLock({
    preferredStrategy: 'file-lock',
    ttlMs,
    heartbeatIntervalMs: heartbeatMs,
  })

  const now = Date.now()
  const leaseTtl = lease.expiresAt - now
  assert.equal(leaseTtl, ttlMs)

  const initialSchedule = scheduled.at(-1)
  assert.ok(initialSchedule, 'initial heartbeat schedule must be captured')
  const expectedNext = Math.max(0, leaseTtl - 5_000)
  assert.equal(initialSchedule?.nextIn, expectedNext)
  assert.ok(initialSchedule?.nextIn <= lease.expiresAt - now)
  assert.ok(lease.nextHeartbeatAt <= lease.expiresAt)
  assert.equal(lease.nextHeartbeatAt - now, expectedNext)

  await releaseProjectLock(lease)
})

scenario('AS-HB-04: TTL override schedules heartbeat five seconds before expiry', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  const ttlMs = 45_000
  const uuids = ['lease-heartbeat-override', 'owner-heartbeat-override']
  t.mock.method(crypto, 'randomUUID', () => {
    const value = uuids.shift()
    if (!value) throw new Error('uuid exhausted')
    return value
  })

  const scheduled: Array<{ lease: ProjectLockLease; nextIn: number }> = []
  const unsubscribe = projectLockEvents.subscribe((event) => {
    if (event.type === 'lock:renew-scheduled') {
      scheduled.push({ lease: event.lease, nextIn: event.nextHeartbeatInMs })
    }
  })
  t.after(unsubscribe)

  const lease = await acquireProjectLock({ preferredStrategy: 'file-lock', ttlMs })

  const now = Date.now()
  const leaseTtl = lease.expiresAt - now
  assert.equal(leaseTtl, ttlMs)

  const initialSchedule = scheduled.at(-1)
  assert.ok(initialSchedule, 'initial heartbeat schedule must be captured')
  assert.equal(initialSchedule?.nextIn, ttlMs - 5_000)
  assert.equal(lease.nextHeartbeatAt - now, ttlMs - 5_000)

  await releaseProjectLock(lease)
})

scenario(
  'AS-LK-22: Fallback conflict warning exposes existing lease metadata',
  {
    navigator: { locks: undefined }
  },
  async (t, ctx) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 25_000 })

    const existingRecord = {
      leaseId: 'existing-lease-id',
      ownerId: 'existing-owner-id',
      acquiredAt: 1_000,
      expiresAt: 31_000,
      ttlSeconds: FALLBACK_LOCK_TTL_MS / 1000,
      mtime: 20_000
    }
    ctx.opfs.files.set(FALLBACK_LOCK_PATH, JSON.stringify(existingRecord))

    const uuids = ['new-lease-id', 'new-owner-id']
    t.mock.method(crypto, 'randomUUID', () => {
      const value = uuids.shift()
      if (!value) throw new Error('uuid exhausted')
      return value
    })

    const warnings: Array<{
      type: 'lock:warning'
      warning: 'fallback-degraded'
      detail?: string
      lease: Pick<
        ProjectLockEvent & { type: 'lock:warning'; warning: 'fallback-degraded' }['lease'],
        'leaseId' | 'ownerId' | 'strategy' | 'viaFallback' | 'resource' | 'acquiredAt' | 'expiresAt' | 'ttlMillis'
      > & { nextHeartbeatAt: number; renewAttempt: number }
    }> = []

    const unsubscribe = projectLockEvents.subscribe((event) => {
      if (event.type === 'lock:warning' && event.warning === 'fallback-degraded') {
        warnings.push({
          type: event.type,
          warning: event.warning,
          detail: event.detail,
          lease: {
            leaseId: event.lease.leaseId,
            ownerId: event.lease.ownerId,
            strategy: event.lease.strategy,
            viaFallback: event.lease.viaFallback,
            resource: event.lease.resource,
            acquiredAt: event.lease.acquiredAt,
            expiresAt: event.lease.expiresAt,
            ttlMillis: event.lease.ttlMillis,
            nextHeartbeatAt: event.lease.nextHeartbeatAt,
            renewAttempt: event.lease.renewAttempt
          }
        })
      }
    })
    t.after(unsubscribe)

    await assert.rejects(async () => {
      await projectLockApi.acquire({ preferredStrategy: 'file-lock', retry: false })
    }, (error: unknown) => {
      assert.ok(error instanceof ProjectLockError)
      assert.equal(error.code, 'fallback-conflict')
      return true
    })

    await assertSnapshot('locks-fallback-conflict-existing-lease', warnings)
  }
)

scenario(
  'AS-LK-23: Fallback conflict warning retains lease metadata after record eviction',
  {
    navigator: { locks: undefined }
  },
  async (t, ctx) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 25_000 })

    const existingRecord = {
      leaseId: 'evicted-lease-id',
      ownerId: 'evicted-owner-id',
      acquiredAt: 2_000,
      expiresAt: 32_000,
      ttlSeconds: FALLBACK_LOCK_TTL_MS / 1000,
      mtime: 21_000
    }
    ctx.opfs.files.set(FALLBACK_LOCK_PATH, JSON.stringify(existingRecord))

    const warnings: Array<{
      type: 'lock:warning'
      warning: 'fallback-degraded'
      detail?: string
      lease: Pick<
        ProjectLockEvent & { type: 'lock:warning'; warning: 'fallback-degraded' }['lease'],
        'leaseId' | 'ownerId' | 'strategy' | 'viaFallback' | 'resource' | 'acquiredAt' | 'expiresAt' | 'ttlMillis'
      > & { nextHeartbeatAt: number; renewAttempt: number }
    }> = []

    let evicted = false
    const unsubscribe = projectLockEvents.subscribe((event) => {
      if (event.type === 'lock:warning' && event.warning === 'fallback-degraded') {
        warnings.push({
          type: event.type,
          warning: event.warning,
          detail: event.detail,
          lease: {
            leaseId: event.lease.leaseId,
            ownerId: event.lease.ownerId,
            strategy: event.lease.strategy,
            viaFallback: event.lease.viaFallback,
            resource: event.lease.resource,
            acquiredAt: event.lease.acquiredAt,
            expiresAt: event.lease.expiresAt,
            ttlMillis: event.lease.ttlMillis,
            nextHeartbeatAt: event.lease.nextHeartbeatAt,
            renewAttempt: event.lease.renewAttempt
          }
        })
        if (!evicted) {
          ctx.opfs.files.delete(FALLBACK_LOCK_PATH)
          evicted = true
        }
      }
    })
    t.after(unsubscribe)

    await assert.rejects(async () => {
      await projectLockApi.acquire({ preferredStrategy: 'file-lock', retry: false })
    }, (error: unknown) => {
      assert.ok(error instanceof ProjectLockError)
      assert.equal(error.code, 'fallback-conflict')
      return true
    })

    await assertSnapshot('locks-fallback-conflict-existing-lease-evicted', warnings)
  }
)

scenario(
  'AS-LK-24: Fallback conflict warning preserves custom heartbeat metadata',
  {
    navigator: { locks: undefined }
  },
  async (t, ctx) => {
    const heartbeatIntervalMs = 17_500
    const nextHeartbeatAt = 58_750
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 41_250 })

    const existingRecord = {
      leaseId: 'custom-heartbeat-lease',
      ownerId: 'custom-heartbeat-owner',
      acquiredAt: 11_250,
      expiresAt: 71_250,
      ttlSeconds: FALLBACK_LOCK_TTL_MS / 1000,
      mtime: 41_250,
      heartbeatIntervalMs,
      nextHeartbeatAt,
    }
    ctx.opfs.files.set(FALLBACK_LOCK_PATH, JSON.stringify(existingRecord))

    const uuids = ['custom-heartbeat-request', 'custom-heartbeat-owner-request']
    t.mock.method(crypto, 'randomUUID', () => {
      const value = uuids.shift()
      if (!value) throw new Error('uuid exhausted')
      return value
    })

    const warnings: Array<{
      type: 'lock:warning'
      warning: 'fallback-degraded'
      lease: Pick<
        ProjectLockEvent & { type: 'lock:warning'; warning: 'fallback-degraded' }['lease'],
        'heartbeatIntervalMs' | 'nextHeartbeatAt'
      >
    }> = []

    const unsubscribe = projectLockEvents.subscribe((event) => {
      if (event.type === 'lock:warning' && event.warning === 'fallback-degraded') {
        warnings.push({
          type: event.type,
          warning: event.warning,
          lease: {
            heartbeatIntervalMs: event.lease.heartbeatIntervalMs,
            nextHeartbeatAt: event.lease.nextHeartbeatAt,
          },
        })
      }
    })
    t.after(unsubscribe)

    await assert.rejects(async () => {
      await projectLockApi.acquire({ preferredStrategy: 'file-lock', retry: false })
    }, (error: unknown) => {
      assert.ok(error instanceof ProjectLockError)
      assert.equal(error.code, 'fallback-conflict')
      return true
    })

    const warning = warnings.at(0)
    assert.ok(warning, 'fallback conflict warning must be emitted')
    assert.equal(warning.lease.heartbeatIntervalMs, heartbeatIntervalMs)
    assert.equal(warning.lease.nextHeartbeatAt, nextHeartbeatAt)
  }
)

scenario(
  'AS-LK-25: Fallback conflict warning surfaces recorded heartbeat schedule',
  {
    navigator: { locks: undefined }
  },
  async (t, ctx) => {
    const heartbeatIntervalMs = 17_500
    const nextHeartbeatAt = 91_250
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 41_250 })

    const existingRecord = {
      leaseId: 'recorded-heartbeat-lease',
      ownerId: 'recorded-heartbeat-owner',
      acquiredAt: 11_250,
      expiresAt: 71_250,
      ttlSeconds: FALLBACK_LOCK_TTL_MS / 1000,
      mtime: 41_250,
      heartbeatIntervalMs,
      nextHeartbeatAt,
    }
    ctx.opfs.files.set(FALLBACK_LOCK_PATH, JSON.stringify(existingRecord))

    const warnings: Array<{
      type: 'lock:warning'
      warning: 'fallback-degraded'
      lease: Pick<
        ProjectLockEvent & { type: 'lock:warning'; warning: 'fallback-degraded' }['lease'],
        'heartbeatIntervalMs' | 'nextHeartbeatAt'
      >
    }> = []

    const unsubscribe = projectLockEvents.subscribe((event) => {
      if (event.type === 'lock:warning' && event.warning === 'fallback-degraded') {
        warnings.push({
          type: event.type,
          warning: event.warning,
          lease: {
            heartbeatIntervalMs: event.lease.heartbeatIntervalMs,
            nextHeartbeatAt: event.lease.nextHeartbeatAt,
          },
        })
      }
    })
    t.after(unsubscribe)

    await assert.rejects(async () => {
      await projectLockApi.acquire({ preferredStrategy: 'file-lock', retry: false })
    }, (error: unknown) => {
      assert.ok(error instanceof ProjectLockError)
      assert.equal(error.code, 'fallback-conflict')
      return true
    })

    assert.ok(warnings.length > 0, 'fallback conflict warning must be emitted at least once')
    for (const warning of warnings) {
      assert.equal(warning.lease.heartbeatIntervalMs, heartbeatIntervalMs)
      assert.equal(warning.lease.nextHeartbeatAt, nextHeartbeatAt)
    }
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

baseScenario(
  'AS-I-09: Lock acquisition failure emits autosave.write.failed telemetry',
  async (t, ctx) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2024, 0, 3, 0, 0, 0) })

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

    runner.markDirty({ pendingBytes: 2048 })

    const policy = ctx.AUTOSAVE_POLICY
    t.mock.timers.tick(policy.debounceMs)
    await Promise.resolve()
    t.mock.timers.tick(policy.idleMs)

    for (let attempt = 0; attempt < AUTOSAVE_RETRY_POLICY.maxAttempts; attempt += 1) {
      const delay = Math.min(
        AUTOSAVE_RETRY_POLICY.initialDelayMs * Math.pow(AUTOSAVE_RETRY_POLICY.multiplier, attempt),
        AUTOSAVE_RETRY_POLICY.maxDelayMs
      )
      t.mock.timers.tick(delay)
      await Promise.resolve()
      await Promise.resolve()
    }

    const failureEvents = ctx.runnerTelemetry.filter(
      (event) => (event.detail as { event?: unknown } | undefined)?.event === 'autosave.write.failed'
    )
    assert.ok(
      failureEvents.length > 0,
      'autosave.write.failed telemetry should be recorded for lock acquisition failure'
    )
    const detail = failureEvents.at(-1)!.detail as Record<string, unknown>
    assert.equal(detail.event, 'autosave.write.failed')
    assert.equal(typeof detail.duration_ms, 'number')
    assert.equal(detail.error_code, 'lock-unavailable')
    assert.equal(detail.retryable, true)
    const cause = detail.cause as Record<string, unknown> | undefined
    assert.ok(cause, 'autosave.write.failed telemetry must include cause metadata')
    assert.equal(cause!.name, 'ProjectLockError')
    assert.equal(typeof cause!.message, 'string')
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
  'AS-LK-16: withProjectLock retains lease when releaseOnError=false',
  {
    navigator: { locks: undefined }
  },
  async (t, ctx) => {
    const telemetry: TelemetrySnapshot = []
    const { sequence, unsubscribe } = collectLockSequence(telemetry)
    t.after(unsubscribe)

    const failure = new Error('executor failure')
    let capturedLease: ProjectLockLease | undefined

    t.after(async () => {
      if (capturedLease) {
        await projectLockApi.release(capturedLease)
      }
    })

    await projectLockApi
      .withProjectLock(async (lease) => {
        capturedLease = lease
        throw failure
      }, { preferredStrategy: 'file-lock', releaseOnError: false })
      .then(
        () => {
          assert.fail('withProjectLock must reject when executor throws')
        },
        (error) => {
          assert.strictEqual(error, failure)
        }
      )

    assert.ok(capturedLease, 'executor must expose acquired lease before throwing')

    const beforeReleaseSequence = sequence.slice()
    assert.equal(
      beforeReleaseSequence.includes('released'),
      false,
      'lease must remain active when releaseOnError=false'
    )
    assert.equal(
      ctx.opfs.files.has(FALLBACK_LOCK_PATH),
      true,
      'fallback lock file must remain present until manual release'
    )
    assert.equal(telemetry.length, 0, 'no telemetry events should be emitted for executor failure')

    await projectLockApi.release(capturedLease!)
    capturedLease = undefined

    assert.equal(
      ctx.opfs.files.has(FALLBACK_LOCK_PATH),
      false,
      'fallback lock file must be removed after manual release'
    )

    const afterReleaseSequence = sequence.slice(beforeReleaseSequence.length)
    assert.ok(afterReleaseSequence.includes('released'), 'manual release must emit lock:released event')
  }
)

scenario(
  'AS-LK-17: withProjectLock defers release when releaseOnError=false',
  {
    navigator: { locks: undefined }
  },
  async (t, ctx) => {
    const releaseEvents: ProjectLockEvent[] = []
    const unsubscribe = projectLockEvents.subscribe((event) => {
      if (event.type === 'lock:release-requested' || event.type === 'lock:released') {
        releaseEvents.push(event)
      }
    })
    t.after(unsubscribe)

    const failure = new Error('executor failure')
    let capturedLease: ProjectLockLease | undefined

    t.after(async () => {
      if (capturedLease) {
        await projectLockApi.release(capturedLease)
      }
    })

    await projectLockApi
      .withProjectLock(async (lease) => {
        capturedLease = lease
        throw failure
      }, { preferredStrategy: 'file-lock', releaseOnError: false })
      .then(
        () => {
          assert.fail('withProjectLock must reject when executor throws')
        },
        (error) => {
          assert.strictEqual(error, failure)
        }
      )

    assert.ok(capturedLease, 'executor must expose acquired lease before throwing')
    assert.equal(releaseEvents.length, 0, 'release events must not fire automatically')
    assert.equal(
      ctx.opfs.files.has(FALLBACK_LOCK_PATH),
      true,
      'fallback lock file must remain present until manual release'
    )

    await projectLockApi.release(capturedLease!)
    capturedLease = undefined

    assert.deepEqual(
      releaseEvents.map((event) => event.type),
      ['lock:release-requested', 'lock:released'],
      'manual release must emit release events once'
    )
    assert.equal(
      ctx.opfs.files.has(FALLBACK_LOCK_PATH),
      false,
      'fallback lock file must be removed after manual release'
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
  t.mock.timers.enable({ apis: ['setTimeout'], now: 0 })
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

  const secondAttempt = releaseProjectLock(lease)
  await Promise.resolve()
  t.mock.timers.tick(500)
  const secondError = await assert.rejects(secondAttempt, (error: unknown) => {
    assert.ok(error instanceof ProjectLockError)
    assert.equal(error.code, 'release-failed')
    return true
  })
  assert.notStrictEqual(secondError, firstError, 'release retry must create a new error instance')
  assert.equal(releaseMock.mock.calls.length, 2, 'release must be invoked twice after two attempts')

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

test('AS-LK-09d: releaseProjectLock failure invokes onReadonly once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'], now: 0 })
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

  const uuids = ['lease-release-onreadonly', 'owner-release-onreadonly']
  t.mock.method(crypto, 'randomUUID', () => {
    const value = uuids.shift()
    if (!value) throw new Error('uuid exhausted')
    return value
  })

  const readonlyCalls: ProjectLockError[] = []
  const onReadonly = (error: ProjectLockError) => {
    readonlyCalls.push(error)
  }

  const lease = await acquireProjectLock({ preferredStrategy: 'web-lock', retry: false })

  const firstError = await assert.rejects(async () => releaseProjectLock(lease, { onReadonly }))
  assert.ok(firstError instanceof ProjectLockError)
  assert.equal(firstError.code, 'release-failed')
  assert.equal(firstError.retryable, true)
  assert.deepEqual(readonlyCalls, [firstError])

  const secondAttempt = releaseProjectLock(lease, { onReadonly })
  await Promise.resolve()
  t.mock.timers.tick(500)
  const secondError = await assert.rejects(secondAttempt, (error: unknown) => {
    assert.ok(error instanceof ProjectLockError)
    assert.equal(error.code, 'release-failed')
    return true
  })
  assert.notStrictEqual(secondError, firstError)
  assert.deepEqual(readonlyCalls, [firstError], 'onReadonly must fire only once across retries')

  const readonlyEvent = events.find(
    (event): event is Extract<ProjectLockEvent, { type: 'lock:readonly-entered' }> => event.type === 'lock:readonly-entered'
  )
  if (!readonlyEvent) {
    assert.fail('lock:readonly-entered not emitted after release failure')
  }
  assert.equal(readonlyEvent.reason, 'release-failed')
  assert.equal(readonlyEvent.retryable, false)

  const errorEvent = events.find(
    (event): event is Extract<ProjectLockEvent, { type: 'lock:error' }> => event.type === 'lock:error'
  )
  if (!errorEvent) {
    assert.fail('lock:error not emitted after release failure')
  }
  assert.equal(errorEvent.operation, 'release')
  assert.equal(errorEvent.retryable, true)
  assert.equal(errorEvent.error.code, 'release-failed')
})

scenario(
  'AS-LK-09e: fallback release failure invokes onReadonly once and caches error',
  { navigator: { locks: undefined } },
  async (t, ctx) => {
    t.mock.timers.enable({ apis: ['setTimeout'], now: 0 })
    const events: ProjectLockEvent[] = []
    const unsubscribe = projectLockEvents.subscribe((event) => {
      events.push(event)
    })
    t.after(unsubscribe)

    const removeEntryCalls: string[] = []
    const originalGetDirectory = ctx.opfs.storage.getDirectory
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
        async removeEntry(name: string) {
          removeEntryCalls.push(name)
          throw new DOMException('Remove blocked', 'InvalidStateError')
        }
      }
    }
    ctx.opfs.storage.getDirectory = async () => wrapDirectory(await originalGetDirectory())
    t.after(() => {
      ctx.opfs.storage.getDirectory = originalGetDirectory
    })

    const readonlyCalls: ProjectLockError[] = []
    const onReadonly = (error: ProjectLockError) => {
      readonlyCalls.push(error)
    }

    const lease = await acquireProjectLock({ preferredStrategy: 'file-lock', retry: false })
    assert.equal(lease.strategy, 'file-lock', 'lease must be acquired via fallback strategy')

    const firstError = (await assert.rejects(async () =>
      releaseProjectLock(lease, { onReadonly })
    )) as ProjectLockError
    assert.equal(firstError.code, 'release-failed')
    assert.equal(firstError.retryable, true)
    assert.deepEqual(readonlyCalls, [firstError], 'onReadonly must fire for the first failure')
    assert.deepEqual(removeEntryCalls, ['.lock'], 'first release attempt must try removing fallback lock')

    const secondAttempt = releaseProjectLock(lease, { onReadonly })
    await Promise.resolve()
    t.mock.timers.tick(500)
    const secondError = (await assert.rejects(async () => secondAttempt)) as ProjectLockError
    assert.notStrictEqual(secondError, firstError, 'release retry must produce a fresh error instance')
    assert.deepEqual(
      readonlyCalls,
      [firstError],
      'onReadonly must not be invoked again during subsequent retry failures'
    )
    assert.deepEqual(
      removeEntryCalls,
      ['.lock', '.lock'],
      'fallback removeEntry must be invoked on each retry despite cached error'
    )

    const readonlyEvents = events.filter(
      (event): event is Extract<ProjectLockEvent, { type: 'lock:readonly-entered' }>
      => event.type === 'lock:readonly-entered'
    )
    assert.equal(readonlyEvents.length, 1, 'readonly downgrade must emit exactly once')
    assert.equal(readonlyEvents[0]?.reason, 'release-failed')

    const errorEvents = events.filter(
      (event): event is Extract<ProjectLockEvent, { type: 'lock:error' }>
      => event.type === 'lock:error'
    )
    assert.equal(errorEvents.length, 1, 'lock:error must emit exactly once for fallback release failure')
    assert.equal(errorEvents[0]?.error.code, 'release-failed')
    assert.equal(errorEvents[0]?.retryable, true)
  }
)

scenario(
  'AS-LK-09f: fallback release retries until success and clears readonly downgrade',
  { navigator: { locks: undefined } },
  async (t, ctx) => {
    t.mock.timers.enable({ apis: ['setTimeout'], now: 0 })
    const events: ProjectLockEvent[] = []
    const unsubscribe = projectLockEvents.subscribe((event) => {
      events.push(event)
    })
    t.after(unsubscribe)

    const originalGetDirectory = ctx.opfs.storage.getDirectory
    let removeAttempts = 0
    const removeEntryCalls: string[] = []
    const wrapDirectory = (
      directory: Awaited<ReturnType<typeof originalGetDirectory>>
    ): Awaited<ReturnType<typeof originalGetDirectory>> => {
      const getDirectoryHandle = directory.getDirectoryHandle.bind(directory)
      const removeEntry = directory.removeEntry.bind(directory)
      return {
        ...directory,
        async getDirectoryHandle(name: string, options?: { create?: boolean }) {
          const next = await getDirectoryHandle(name, options as { create?: boolean })
          return wrapDirectory(next)
        },
        async removeEntry(name: string) {
          removeAttempts += 1
          removeEntryCalls.push(name)
          if (removeAttempts === 1) {
            throw new DOMException('Remove blocked once', 'InvalidStateError')
          }
          await removeEntry(name)
        }
      }
    }
    ctx.opfs.storage.getDirectory = async () => wrapDirectory(await originalGetDirectory())
    t.after(() => {
      ctx.opfs.storage.getDirectory = originalGetDirectory
    })

    const lease = await acquireProjectLock({ preferredStrategy: 'file-lock', retry: false })
    assert.equal(lease.strategy, 'file-lock', 'lease must be acquired via fallback strategy')

    await assert.rejects(async () => releaseProjectLock(lease), (error: unknown) => {
      assert.ok(error instanceof ProjectLockError)
      assert.equal(error.code, 'release-failed')
      return true
    })

    assert.deepEqual(removeEntryCalls, ['.lock'], 'first release attempt must try removing fallback lock')

    const retryPromise = releaseProjectLock(lease)
    await Promise.resolve()
    t.mock.timers.tick(500)
    await retryPromise

    assert.deepEqual(
      removeEntryCalls,
      ['.lock', '.lock'],
      'second release attempt must retry removing fallback lock'
    )

    const firstReleaseRequestedIndex = events.findIndex(
      (event): event is Extract<ProjectLockEvent, { type: 'lock:release-requested' }>
        => event.type === 'lock:release-requested' && event.lease.leaseId === lease.leaseId
    )
    assert.notEqual(firstReleaseRequestedIndex, -1, 'lock:release-requested must be emitted before release attempts')

    const errorIndex = events.findIndex(
      (event): event is Extract<ProjectLockEvent, { type: 'lock:error' }>
        => event.type === 'lock:error' && event.operation === 'release'
    )
    assert.notEqual(errorIndex, -1, 'lock:error must be emitted after release failure')
    assert.ok(errorIndex > firstReleaseRequestedIndex, 'lock:error must follow lock:release-requested')
    const errorEvent = events[errorIndex] as Extract<ProjectLockEvent, { type: 'lock:error' }>
    assert.equal(errorEvent.retryable, true, 'lock:error must mark release failure as retryable')

    const releasedIndex = events.findIndex(
      (event): event is Extract<ProjectLockEvent, { type: 'lock:released' }>
        => event.type === 'lock:released' && event.leaseId === lease.leaseId
    )
    assert.notEqual(releasedIndex, -1, 'lock:released must be emitted after successful retry')
    assert.ok(releasedIndex > errorIndex, 'lock:released must follow lock:error retry event')

    const readonlyEvents = events.filter(
      (event): event is Extract<ProjectLockEvent, { type: 'lock:readonly-entered' }>
        => event.type === 'lock:readonly-entered' && event.reason === 'release-failed'
    )
    assert.equal(readonlyEvents.length, 1, 'lock:readonly-entered must emit once on initial failure')
  }
)

scenario(
  'AS-LK-09g: fallback release waits for two retries before succeeding',
  { navigator: { locks: undefined } },
  async (t, ctx) => {
    t.mock.timers.enable({ apis: ['setTimeout'], now: 0 })
    const events: ProjectLockEvent[] = []
    const unsubscribe = projectLockEvents.subscribe((event) => {
      events.push(event)
    })
    t.after(unsubscribe)

    const originalGetDirectory = ctx.opfs.storage.getDirectory
    let removeAttempts = 0
    const removeEntryCalls: string[] = []
    const wrapDirectory = (
      directory: Awaited<ReturnType<typeof originalGetDirectory>>
    ): Awaited<ReturnType<typeof originalGetDirectory>> => {
      const getDirectoryHandle = directory.getDirectoryHandle.bind(directory)
      const removeEntry = directory.removeEntry.bind(directory)
      return {
        ...directory,
        async getDirectoryHandle(name: string, options?: { create?: boolean }) {
          const next = await getDirectoryHandle(name, options as { create?: boolean })
          return wrapDirectory(next)
        },
        async removeEntry(name: string) {
          removeAttempts += 1
          removeEntryCalls.push(name)
          if (removeAttempts <= 2) {
            throw new DOMException('Remove blocked temporarily', 'InvalidStateError')
          }
          await removeEntry(name)
        }
      }
    }
    ctx.opfs.storage.getDirectory = async () => wrapDirectory(await originalGetDirectory())
    t.after(() => {
      ctx.opfs.storage.getDirectory = originalGetDirectory
    })

    const lease = await acquireProjectLock({ preferredStrategy: 'file-lock', retry: false })
    assert.equal(lease.strategy, 'file-lock')

    await assert.rejects(async () => releaseProjectLock(lease), (error: unknown) => {
      assert.ok(error instanceof ProjectLockError)
      assert.equal(error.code, 'release-failed')
      return true
    })

    const secondAttempt = releaseProjectLock(lease)
    await Promise.resolve()
    t.mock.timers.tick(500)
    await assert.rejects(async () => secondAttempt, (error: unknown) => {
      assert.ok(error instanceof ProjectLockError)
      assert.equal(error.code, 'release-failed')
      return true
    })

    const thirdAttempt = releaseProjectLock(lease)
    await Promise.resolve()
    t.mock.timers.tick(1000)
    await thirdAttempt

    assert.deepEqual(
      removeEntryCalls,
      ['.lock', '.lock', '.lock'],
      'fallback removal must run for all three attempts'
    )

    const releaseEvents = events.filter(
      (event): event is Extract<ProjectLockEvent, { type: 'lock:released' }>
        => event.type === 'lock:released' && event.leaseId === lease.leaseId
    )
    assert.equal(releaseEvents.length, 1, 'lock:released must emit once after successful retry')

    const readonlyEvents = events.filter(
      (event): event is Extract<ProjectLockEvent, { type: 'lock:readonly-entered' }>
        => event.type === 'lock:readonly-entered' && event.reason === 'release-failed'
    )
    assert.equal(readonlyEvents.length, 1, 'readonly downgrade must still emit exactly once')

    const errorEvents = events.filter(
      (event): event is Extract<ProjectLockEvent, { type: 'lock:error' }>
        => event.type === 'lock:error' && event.operation === 'release'
    )
    assert.equal(errorEvents.length, 2, 'two release retries must emit two error events')
  }
)

scenario(
  'AS-LK-09h: fallback release stops after three failures and keeps cached error',
  { navigator: { locks: undefined } },
  async (t, ctx) => {
    t.mock.timers.enable({ apis: ['setTimeout'], now: 0 })
    const events: ProjectLockEvent[] = []
    const unsubscribe = projectLockEvents.subscribe((event) => {
      events.push(event)
    })
    t.after(unsubscribe)

    const originalGetDirectory = ctx.opfs.storage.getDirectory
    let removeAttempts = 0
    const removeEntryCalls: string[] = []
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
        async removeEntry(name: string) {
          removeAttempts += 1
          removeEntryCalls.push(name)
          throw new DOMException('Remove blocked', 'InvalidStateError')
        }
      }
    }
    ctx.opfs.storage.getDirectory = async () => wrapDirectory(await originalGetDirectory())
    t.after(() => {
      ctx.opfs.storage.getDirectory = originalGetDirectory
    })

    const readonlyCalls: ProjectLockError[] = []
    const lease = await acquireProjectLock({ preferredStrategy: 'file-lock', retry: false })

    await assert.rejects(async () => releaseProjectLock(lease, { onReadonly: (error) => readonlyCalls.push(error) }), (error: unknown) => {
      assert.ok(error instanceof ProjectLockError)
      assert.equal(error.code, 'release-failed')
      return true
    })

    const secondAttempt = releaseProjectLock(lease, { onReadonly: (error) => readonlyCalls.push(error) })
    await Promise.resolve()
    t.mock.timers.tick(500)
    await assert.rejects(async () => secondAttempt, (error: unknown) => {
      assert.ok(error instanceof ProjectLockError)
      assert.equal(error.code, 'release-failed')
      return true
    })

    const thirdAttempt = releaseProjectLock(lease, { onReadonly: (error) => readonlyCalls.push(error) })
    await Promise.resolve()
    t.mock.timers.tick(1000)
    const finalError = await assert.rejects(async () => thirdAttempt, (error: unknown) => {
      assert.ok(error instanceof ProjectLockError)
      assert.equal(error.code, 'release-failed')
      assert.equal(error.retryable, true)
      return true
    })

    const cachedError = await assert.rejects(async () => releaseProjectLock(lease), (error: unknown) => {
      assert.strictEqual(error, finalError)
      return true
    })
    assert.strictEqual(cachedError, finalError)

    assert.deepEqual(removeEntryCalls, ['.lock', '.lock', '.lock'], 'release must attempt three times before caching error')
    assert.equal(readonlyCalls.length, 1, 'onReadonly must still fire only once')

    const readonlyEvents = events.filter(
      (event): event is Extract<ProjectLockEvent, { type: 'lock:readonly-entered' }>
        => event.type === 'lock:readonly-entered' && event.reason === 'release-failed'
    )
    assert.equal(readonlyEvents.length, 1, 'readonly downgrade must emit once after max retries')

    const releaseEvents = events.filter(
      (event): event is Extract<ProjectLockEvent, { type: 'lock:released' }>
        => event.type === 'lock:released' && event.leaseId === lease.leaseId
    )
    assert.equal(releaseEvents.length, 0, 'lock:released must never emit after exhausting retries')
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
