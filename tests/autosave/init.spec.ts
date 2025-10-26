import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'

import { scenario } from '../lib/autosave/setup'

import type { Storyboard } from '../../src/types'

const createStoryboard = (): Storyboard => ({
  id: 'autosave-test',
  title: 'AutoSave Test',
  scenes: [],
  selection: [],
  version: 1
})

const withEnv = (t: TestContext, value: string | undefined) => {
  const previous = process.env.VITE_AUTOSAVE_ENABLED
  if (value === undefined){
    delete process.env.VITE_AUTOSAVE_ENABLED
  } else {
    process.env.VITE_AUTOSAVE_ENABLED = value
  }
  t.after(() => {
    if (previous === undefined){
      delete process.env.VITE_AUTOSAVE_ENABLED
    } else {
      process.env.VITE_AUTOSAVE_ENABLED = previous
    }
  })
}

scenario('AS-U-01 env flag OFF disables AutoSave runner', (t, { initAutoSave }) => {
  withEnv(t, '0')
  const runner = initAutoSave(() => createStoryboard(), { disabled: false })
  assert.equal(runner.snapshot().phase, 'disabled')
})

scenario('AS-U-02 env flag ON enables AutoSave runner', (t, { initAutoSave }) => {
  withEnv(t, '1')
  const runner = initAutoSave(() => createStoryboard(), { disabled: false })
  assert.equal(runner.snapshot().phase, 'idle')
  runner.markDirty({ pendingBytes: 512 })
  assert.equal(runner.snapshot().phase, 'dirty')
})

scenario('AS-U-03 localStorage override enables AutoSave when env unset', (t, { initAutoSave }) => {
  withEnv(t, undefined)
  const storage = new Map<string, string>([['autosave.enabled', '1']])
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (key: string) => storage.get(key) ?? null },
    configurable: true
  })
  t.after(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage
  })
  const runner = initAutoSave(() => createStoryboard(), { disabled: false })
  assert.equal(runner.snapshot().phase, 'idle')
})
