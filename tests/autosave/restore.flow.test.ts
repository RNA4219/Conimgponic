import assert from 'node:assert/strict'

import { scenario } from '../lib/autosave/setup'

import type { AutoSaveError } from '../../src/lib/autosave'
import { ProjectLockError } from '../../src/lib/locks'

const expectAutoSaveError = (
  expected: Pick<AutoSaveError, 'code' | 'retryable'>
): ((error: unknown) => error is AutoSaveError) =>
  (error: unknown): error is AutoSaveError => {
    if (!error || typeof error !== 'object') return false
    const candidate = error as Partial<AutoSaveError>
    return candidate.code === expected.code && candidate.retryable === expected.retryable
  }

const sanitize = (ts: string): string => ts.replace(/[:.]/g, '-')

scenario(
  'restoreFrom surfaces lock acquisition failure as AutoSaveError(lock-unavailable)',
  {
    locks: {
      async request() {
        throw new ProjectLockError('acquire-failed', 'denied', {
          retryable: true,
          operation: 'acquire'
        })
      }
    }
  },
  async (_t, { restoreFrom }) => {
    await assert.rejects(
      () => restoreFrom('2024-01-02T03:04:05.006Z'),
      expectAutoSaveError({ code: 'lock-unavailable', retryable: true })
    )
  }
)

scenario('restoreFrom throws history-overflow when history payload is missing', async (_t, { restoreFrom, opfs }) => {
  const ts = '2024-01-03T04:05:06.007Z'
  opfs.files.set(
    `project/autosave/index.json`,
    JSON.stringify({
      current: null,
      history: [
        { ts, bytes: 128, location: 'history', retained: true }
      ]
    })
  )
  await assert.rejects(
    () => restoreFrom(ts),
    expectAutoSaveError({ code: 'history-overflow', retryable: false })
  )
})

{
  const counters = { request: 0, release: 0 }

  scenario(
    'restoreFrom acquires and releases lock without collector side effects on success',
    {
      locks: {
        async request(
          name: string,
          maybeOptions?: unknown,
          maybeCallback?: (lock: { release: () => Promise<void> }) => unknown | Promise<unknown>
        ) {
          counters.request += 1
          assert.equal(name, 'project:autosave')
          const callback =
            typeof maybeOptions === 'function'
              ? maybeOptions
              : typeof maybeCallback === 'function'
                ? maybeCallback
                : undefined
          assert.ok(callback, 'expected navigator.locks.request callback')
          const handle = {
            async release() {
              counters.release += 1
            }
          }
          await callback(handle)
          return handle
        }
      }
    },
    async (t, { restoreFrom, opfs }) => {
      counters.request = 0
      counters.release = 0
      const ts = '2024-01-04T05:06:07.008Z'
      const sanitized = sanitize(ts)
      opfs.files.set(`project/autosave/history/${sanitized}.json`, JSON.stringify({ foo: 'bar' }))

      const scope = globalThis as typeof globalThis & {
        Day8Collector?: { publish: (event: Record<string, unknown>) => void }
      }
      const events: Record<string, unknown>[] = []
      Object.defineProperty(scope, 'Day8Collector', {
        value: {
          publish(event: Record<string, unknown>) {
            events.push(event)
          }
        },
        configurable: true
      })
      t.after(() => {
        delete scope.Day8Collector
      })

      const restored = await restoreFrom(ts)
      assert.equal(restored, true)
      assert.deepEqual(events, [])
      assert.equal(counters.request, 1)
      assert.equal(counters.release, 1)
    }
  )
}
