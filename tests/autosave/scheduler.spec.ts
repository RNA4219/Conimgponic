import assert from 'node:assert/strict'

import { ENABLED_GUARD, scenario } from '../lib/autosave/setup'

import type { Storyboard } from '../../src/types'

type AutoSavePhase = import('../../src/lib/autosave').AutoSavePhase

const makeStoryboard = (): Storyboard => ({
  id: 'storyboard',
  title: 'Storyboard',
  scenes: [
    { id: 'alpha', manual: '', ai: '', status: 'idle', assets: [] },
    { id: 'beta', manual: '', ai: '', status: 'idle', assets: [] }
  ],
  selection: [],
  version: 1
})

scenario('AS-I-04: flushNow bypasses debounce delay and reaches awaiting-lock with fake timers', async (t, ctx) => {
  const { initAutoSave, opfs } = ctx
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'], now: 0 })
  const runner = initAutoSave(makeStoryboard, { disabled: false }, ENABLED_GUARD)
  assert.equal(runner.snapshot().phase, 'idle')

  runner.markDirty({ pendingBytes: 1024 })
  assert.equal(runner.snapshot().phase, 'debouncing')

  const timeline: AutoSavePhase[] = []
  const pending = runner.flushNow()
  timeline.push(runner.snapshot().phase)
  await Promise.resolve()
  timeline.push(runner.snapshot().phase)
  await pending
  timeline.push(runner.snapshot().phase)

  assert.ok(timeline.includes('awaiting-lock'), 'expected awaiting-lock in transition path')
  assert.equal(timeline.at(-1), 'idle')
  assert.ok(opfs.files.has('project/autosave/current.json'))
  assert.ok(opfs.files.has('project/autosave/index.json'))
  await runner.dispose()
})
