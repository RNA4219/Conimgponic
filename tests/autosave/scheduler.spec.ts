import assert from 'node:assert/strict'

import { ENABLED_GUARD, scenario } from '../lib/autosave/setup'

import type { Storyboard } from '../../src/types'

const createStoryboard = (): Storyboard => ({
  id: 'autosave-test',
  title: 'AutoSave Test',
  scenes: [],
  selection: [],
  version: 1
})

scenario('AS-I-04 flushNow and auto timers drive expected phase transitions', async (t, ctx) => {
  const { initAutoSave, AUTOSAVE_POLICY, opfs } = ctx
  t.mock.timers.enable({ apis: ['setTimeout'], now: 0 })
  const runner = initAutoSave(() => createStoryboard(), { disabled: false }, ENABLED_GUARD)

  runner.markDirty({ pendingBytes: 128 })
  assert.equal(runner.snapshot().phase, 'dirty')

  t.mock.timers.tick(AUTOSAVE_POLICY.debounceMs + AUTOSAVE_POLICY.idleMs - 1)
  await Promise.resolve()
  assert.equal(runner.snapshot().phase, 'dirty')

  t.mock.timers.tick(1)
  await Promise.resolve()
  assert.equal(runner.snapshot().phase, 'awaiting-lock')
  await Promise.resolve()
  assert.equal(runner.snapshot().phase, 'idle')
  assert.ok(opfs.files.has('project/autosave/current.json'))

  const flushPromise = runner.flushNow()
  assert.equal(runner.snapshot().phase, 'debouncing')
  await Promise.resolve()
  assert.equal(runner.snapshot().phase, 'awaiting-lock')
  await flushPromise
  assert.equal(runner.snapshot().phase, 'idle')
})
