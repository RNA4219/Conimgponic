import assert from 'node:assert/strict'

import { scenario } from './setup'

scenario('flushNow persists storyboard and restorePrompt exposes metadata', async (_t, { initAutoSave, restorePrompt, opfs }) => {
  const runner = initAutoSave(() => ({ nodes: [{ id: 'hero' }] } as any), { disabled: false })
  await runner.flushNow()
  const meta = await restorePrompt()
  assert.equal(runner.snapshot().phase, 'idle')
  assert.ok(opfs.files.has('project/autosave/current.json'))
  assert.ok(opfs.files.has('project/autosave/index.json'))
  assert.equal(meta?.source, 'current')
})

scenario('history rotation keeps at most 20 generations', async (_t, { initAutoSave, opfs }) => {
  const runner = initAutoSave(() => ({ nodes: [] } as any), { disabled: false })
  for (let i = 0; i < 22; i++) await runner.flushNow()
  assert.ok(Array.from(opfs.files.keys()).filter((k) => k.startsWith('project/autosave/history/')).length <= 20)
})

scenario(
  'lock failure surfaces AutoSaveError with retryable flag',
  { locks: { async request(){ throw new Error('denied') } } },
  async (_t, { initAutoSave }) => {
    const runner = initAutoSave(() => ({ nodes: [] } as any), { disabled: false })
    await assert.rejects(runner.flushNow(), (error: any) => error?.code === 'lock-unavailable' && error?.retryable === true)
  }
)
