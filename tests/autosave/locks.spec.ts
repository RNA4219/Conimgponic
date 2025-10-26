import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { scenario } from '../lib/autosave/setup'
import { projectLockApi, ProjectLockError } from '../../src/lib/locks'

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

const collectLockSequence = (telemetry: TelemetrySnapshot) => {
  const sequence: LockSnapshotEvent[] = []
  const unsubscribe = projectLockApi.events.subscribe((event) => {
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
  'AS-I-03: Non-retryable Web Lock failure stops acquisition with telemetry',
  {
    locks: {
      async request(_key, _options, callback) {
        await callback({})
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

    await assert.rejects(async () => projectLockApi.acquire({ preferredStrategy: 'web-lock', retry: false }), (error) => {
      assert.ok(error instanceof ProjectLockError)
      assert.equal(error.retryable, false)
      return true
    })

    await assertSnapshot('locks-non-retryable', { lockSequence: sequence, telemetry })
  }
)
