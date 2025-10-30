import assert from 'node:assert/strict'

import { ENABLED_GUARD, scenario } from '../lib/autosave/setup'

import type { AutoSaveError } from '../../src/lib/autosave'
import type { Storyboard } from '../../src/types'
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

const EMPTY_INDEX = JSON.stringify({ current: null, history: [], generation: null })

scenario(
  'AS-TDD-03: corrupted autosave payloads do not surface guard or telemetry side effects',
  async (_t, ctx) => {
    const {
      opfs,
      restoreFromCurrent,
      restoreFrom,
      restorePrompt,
      guardSnapshots,
      collectorEvents,
      runnerTelemetry
    } = ctx

    const ts = '2024-04-05T06:07:08.009Z'
    const sanitized = sanitize(ts)

    opfs.files.set('project/autosave/index.json', EMPTY_INDEX)
    opfs.files.set('project/autosave/current.json', '{ invalid json }')
    opfs.files.set(`project/autosave/history/${sanitized}.json`, '{ invalid history json }')

    await assert.rejects(
      () => restoreFromCurrent(),
      expectAutoSaveError({ code: 'data-corrupted', retryable: false })
    )

    await assert.rejects(
      () => restoreFrom(ts),
      expectAutoSaveError({ code: 'data-corrupted', retryable: false })
    )

    const prompt = await restorePrompt()
    assert.equal(prompt, null)
    assert.deepEqual(guardSnapshots, [])
    assert.deepEqual(collectorEvents, [])
    assert.deepEqual(runnerTelemetry, [])
  }
)

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

scenario(
  'AS-I-01: restart with autosave disabled suppresses restore flow activation',
  async (t, ctx) => {
    const previousFlag = process.env.VITE_AUTOSAVE_ENABLED
    process.env.VITE_AUTOSAVE_ENABLED = '0'
    t.after(() => {
      if (previousFlag === undefined) {
        delete process.env.VITE_AUTOSAVE_ENABLED
      } else {
        process.env.VITE_AUTOSAVE_ENABLED = previousFlag
      }
    })

    const storyboard: Storyboard = {
      id: 'autosave-as-i-01',
      title: 'AS-I-01 Baseline',
      scenes: [
        { id: 'intro', manual: '', ai: '', status: 'idle', assets: [] },
        { id: 'conflict', manual: '', ai: '', status: 'idle', assets: [] },
        { id: 'resolve', manual: '', ai: '', status: 'idle', assets: [] }
      ],
      selection: [],
      version: 1
    }

    const historyTs = '2024-03-01T10:05:00.000Z'
    ctx.opfs.files.set(
      `project/autosave/history/${sanitize(historyTs)}.json`,
      JSON.stringify({ projectId: storyboard.id, ts: historyTs })
    )

    const runner = ctx.initAutoSave(() => storyboard, { disabled: false }, ENABLED_GUARD)
    assert.equal(runner.snapshot().phase, 'disabled')
    assert.deepEqual(ctx.collectorEvents, [])
    assert.ok(
      ctx.runnerTelemetry.every((event) => event.detail?.event !== 'autosave.schedule.requested'),
      'autosave.schedule.requested telemetry should not appear'
    )

    await runner.dispose()

    const prompt = await ctx.restorePrompt()
    assert.equal(prompt, null)
    assert.deepEqual(ctx.collectorEvents, [])

    const restartRunner = ctx.initAutoSave(
      () => storyboard,
      { disabled: false },
      { autosave: { enabled: false, phase: 'disabled', source: 'env' } }
    )
    assert.equal(restartRunner.snapshot().phase, 'disabled')

    const latestGuard = ctx.guardSnapshots.at(-1)
    assert.ok(latestGuard, 'expected guard snapshot to be recorded on restart')
    const guardRecord = latestGuard as Record<string, unknown>
    const autosaveRecord = guardRecord.autosave as { phase?: string } | undefined
    assert.equal(autosaveRecord?.phase, 'disabled')

    assert.ok(
      ctx.runnerTelemetry.every((event) => event.detail?.event !== 'autosave.schedule.requested'),
      'autosave.schedule.requested telemetry should never be emitted'
    )
    assert.deepEqual(ctx.collectorEvents, [])

    await restartRunner.dispose()
  }
)
