import assert from 'node:assert/strict'

import { scenario } from './setup'

import type { Storyboard } from '../../../src/types'

const makeStoryboard = (): Storyboard => ({
  id: 'storyboard',
  title: 'Storyboard',
  scenes: [
    {
      id: 'scene-1',
      manual: 'manual',
      ai: 'ai',
      status: 'idle',
      assets: []
    }
  ],
  selection: [],
  version: 1
})

scenario('autosave persistence exposes latest generation via restore APIs', async (t, ctx) => {
  const { initAutoSave, restorePrompt, listHistory, opfs } = ctx
  const now = Date.UTC(2024, 0, 1, 12, 0, 0)
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })

  const runner = initAutoSave(makeStoryboard, { disabled: false })
  await runner.flushNow()

  const prompt = await restorePrompt()
  assert.ok(prompt, 'restorePrompt should return metadata for the latest generation')
  assert.equal(prompt.source, 'current')
  assert.equal(prompt.location, 'project/autosave/current.json')
  assert.equal(prompt.ts, new Date(now).toISOString())

  const currentPayload = opfs.files.get('project/autosave/current.json') ?? ''
  const expectedBytes = Buffer.byteLength(currentPayload, 'utf8')
  assert.equal(prompt.bytes, expectedBytes)

  const history = await listHistory()
  assert.equal(history.length, 1)
  assert.equal(history[0]!.ts, prompt.ts)
  assert.equal(history[0]!.retained, true)
  assert.equal(history[0]!.location, 'history')
})
