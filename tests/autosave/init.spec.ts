import assert from 'node:assert/strict'

import { scenario } from '../lib/autosave/setup'

import type { Storyboard } from '../../src/types'

const makeStoryboard = (): Storyboard => ({
  id: 'storyboard',
  title: 'Storyboard',
  scenes: [
    { id: 'intro', manual: '', ai: '', status: 'idle', assets: [] },
    { id: 'conflict', manual: '', ai: '', status: 'idle', assets: [] },
    { id: 'resolve', manual: '', ai: '', status: 'idle', assets: [] }
  ],
  selection: [],
  version: 1
})

type MutableEnv = NodeJS.ProcessEnv & { VITE_AUTOSAVE_ENABLED?: string }

type TestScope = typeof globalThis & {
  Day8Collector?: { publish: (event: Record<string, unknown>) => void }
  localStorage?: { getItem: (key: string) => string | null }
}

const resetEnv = (restore: string | undefined) => {
  const env = process.env as MutableEnv
  if (restore === undefined) {
    delete env.VITE_AUTOSAVE_ENABLED
  } else {
    env.VITE_AUTOSAVE_ENABLED = restore
  }
}

scenario('AS-U-01: env flag disabled keeps runner inert and reports guard telemetry', async (t, { initAutoSave, opfs }) => {
  const env = process.env as MutableEnv
  const previous = env.VITE_AUTOSAVE_ENABLED
  env.VITE_AUTOSAVE_ENABLED = '0'
  const scope = globalThis as TestScope
  const events: Record<string, unknown>[] = []
  Object.defineProperty(scope, 'Day8Collector', {
    value: { publish: (event: Record<string, unknown>) => events.push(event) },
    configurable: true
  })
  t.after(() => {
    delete scope.Day8Collector
    resetEnv(previous)
  })

  const runner = initAutoSave(makeStoryboard, { disabled: false })
  assert.equal(runner.snapshot().phase, 'disabled')
  await assert.doesNotReject(() => runner.flushNow())
  await assert.doesNotReject(() => runner.dispose())
  assert.equal(opfs.files.size, 0)
  assert.deepEqual(
    events.map((event) => ({
      feature: event.feature,
      phase: event.phase,
      reason: event.reason
    })),
    [
      {
        feature: 'autosave-diff-merge',
        phase: 'disabled',
        reason: 'feature-flag-disabled'
      }
    ]
  )
})

scenario('AS-U-02: env flag enabled starts runner and flushes storyboard immediately', async (t, { initAutoSave, opfs }) => {
  const env = process.env as MutableEnv
  const previous = env.VITE_AUTOSAVE_ENABLED
  env.VITE_AUTOSAVE_ENABLED = 'true'
  t.after(() => {
    resetEnv(previous)
  })

  const runner = initAutoSave(makeStoryboard, { disabled: false })
  assert.equal(runner.snapshot().phase, 'idle')
  await runner.flushNow()
  assert.equal(runner.snapshot().phase, 'idle')
  assert.ok(opfs.files.has('project/autosave/current.json'))
  assert.ok(opfs.files.has('project/autosave/index.json'))
  await runner.dispose()
})

scenario('AS-U-03: localStorage override enables runner when env flag unset', async (t, { initAutoSave }) => {
  const env = process.env as MutableEnv
  const previous = env.VITE_AUTOSAVE_ENABLED
  delete env.VITE_AUTOSAVE_ENABLED
  const scope = globalThis as TestScope
  const storage = new Map<string, string>()
  storage.set('autosave.enabled', 'true')
  Object.defineProperty(scope, 'localStorage', {
    value: { getItem: (key: string) => storage.get(key) ?? null },
    configurable: true
  })
  t.after(() => {
    delete scope.localStorage
    resetEnv(previous)
  })

  const runner = initAutoSave(makeStoryboard, { disabled: false })
  assert.equal(runner.snapshot().phase, 'idle')
  await runner.flushNow()
  assert.equal(runner.snapshot().phase, 'idle')
  await runner.dispose()
})
