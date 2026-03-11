import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { scenario } from '../lib/autosave/setup'
import type { Storyboard } from '../../src/types'

/* -----------------------------
 * Storyboard factory
 * ----------------------------- */
const createStoryboard = (): Storyboard => ({
  id: 'autosave-test',
  title: 'AutoSave Test',
  scenes: [
    { id: 'intro', manual: '', ai: '', status: 'idle', assets: [] },
    { id: 'conflict', manual: '', ai: '', status: 'idle', assets: [] },
    { id: 'resolve', manual: '', ai: '', status: 'idle', assets: [] }
  ],
  selection: [],
  version: 1
})

/* -----------------------------
 * Helper: env restore
 * ----------------------------- */
const withEnv = (t: TestContext, value: string | undefined) => {
  const previous = process.env.VITE_AUTOSAVE_ENABLED
  if (value === undefined) {
    delete process.env.VITE_AUTOSAVE_ENABLED
  } else {
    process.env.VITE_AUTOSAVE_ENABLED = value
  }
  t.after(() => {
    if (previous === undefined) {
      delete process.env.VITE_AUTOSAVE_ENABLED
    } else {
      process.env.VITE_AUTOSAVE_ENABLED = previous
    }
  })
}

/* -----------------------------
 * AS-U-01: env flag disabled
 * ----------------------------- */
scenario(
  'AS-U-01: env flag disabled keeps runner inert and reports guard telemetry',
  async (t, { initAutoSave, opfs }) => {
    withEnv(t, '0')

    const events: Record<string, unknown>[] = []
    Object.defineProperty(globalThis, 'Day8Collector', {
      value: { publish: (e: Record<string, unknown>) => events.push(e) },
      configurable: true
    })
    t.after(() => {
      delete (globalThis as { Day8Collector?: unknown }).Day8Collector
    })

    const runner = initAutoSave(() => createStoryboard(), { disabled: false })
    assert.equal(runner.snapshot().phase, 'disabled')
    await assert.doesNotReject(() => runner.flushNow())
    await assert.doesNotReject(() => runner.dispose())
    assert.equal(opfs.files.size, 0)
    assert.deepEqual(
      events.map((e) => ({
        feature: e.feature,
        phase: e.phase,
        reason: e.reason
      })),
      [
        {
          feature: 'autosave-diff-merge',
          phase: 'disabled',
          reason: 'feature-flag-disabled'
        }
      ]
    )
  }
)

/* -----------------------------
 * AS-U-02: env flag enabled
 * ----------------------------- */
scenario.skip(
  'AS-U-02: env flag enabled starts runner and flushes storyboard immediately',
  async (t, { initAutoSave, opfs }) => {
    withEnv(t, 'true')

    const runner = initAutoSave(() => createStoryboard(), { disabled: false })
    assert.equal(runner.snapshot().phase, 'idle')
    await runner.flushNow()
    assert.equal(runner.snapshot().phase, 'idle')
    assert.ok(opfs.files.has('project/autosave/current.json'))
    assert.ok(opfs.files.has('project/autosave/index.json'))
    await runner.dispose()
  }
)

/* -----------------------------
 * AS-U-03: localStorage override
 * ----------------------------- */
scenario(
  'AS-U-03: localStorage override enables runner when env flag unset',
  async (t, { initAutoSave }) => {
    withEnv(t, undefined)
    const storage = new Map<string, string>([['autosave.enabled', 'true']])
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: (key: string) => storage.get(key) ?? null },
      configurable: true
    })
    t.after(() => {
      delete (globalThis as { localStorage?: unknown }).localStorage
    })

    const runner = initAutoSave(() => createStoryboard(), { disabled: false })
    assert.equal(runner.snapshot().phase, 'idle')
    await runner.flushNow()
    assert.equal(runner.snapshot().phase, 'idle')
    await runner.dispose()
  }
)
