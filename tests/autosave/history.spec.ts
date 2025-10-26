import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { beforeEach } from 'node:test'
import type { TestContext } from 'node:test'

import { ENABLED_GUARD, scenario } from '../lib/autosave/setup'
import type { AutoSaveInitResult } from '../../src/lib/autosave'
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

  const policy = { ...ctx.AUTOSAVE_POLICY, maxGenerations: 2, maxBytes: 16 * 1024 }
  t.mock.method(ctx, 'resolveAutoSavePolicy', () => policy)

  const runner = ctx.initAutoSave(createStoryboard, { disabled: false }, ENABLED_GUARD)

  const flushViaIdle = async () => {
    runner.markDirty({ pendingBytes: 2048 })
    t.mock.timers.tick(policy.debounceMs)
    await Promise.resolve()
    t.mock.timers.tick(policy.idleMs)
    await waitForIdle(t, runner)
  }

  await flushViaIdle()
  t.mock.timers.tick(10)
  await flushViaIdle()
  t.mock.timers.tick(10)
  await flushViaIdle()

  await runner.dispose()

  const writes = collectAutoSaveWrites(ctx.opfs)
  const expectation = {
    writes: writes.map(({ bytes: _bytes, ...rest }) => rest),
    telemetry
  }

  const historyBytes = writes
    .filter(({ path }) => path.startsWith('project/autosave/history/'))
    .reduce((total, entry) => total + entry.bytes, 0)
  assert.ok(historyBytes <= policy.maxBytes)

  await assertSnapshot('history-as-i-02', expectation)
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
