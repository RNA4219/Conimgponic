import assert from 'node:assert/strict'

import { scenario } from './setup'

scenario('flushNow persists storyboard and restorePrompt exposes metadata', async (_t, { initAutoSave, restorePrompt, opfs }) => {
  const runner = initAutoSave(() => ({ nodes: [{ id: 'hero' }] } as any), { disabled: false })
  await runner.flushNow()
  const meta = await restorePrompt()
  assert.equal(runner.snapshot().phase, 'idle')
  assert.ok(opfs.files.has('project/autosave/current.json')); assert.ok(opfs.files.has('project/autosave/index.json'))
  assert.ok(!opfs.files.has('project/autosave/current.json.tmp')); assert.ok(!opfs.files.has('project/autosave/index.json.tmp'))
  assert.ok(Array.from(opfs.files.keys()).some((key) => key.startsWith('project/autosave/history/')))
  const index = JSON.parse(opfs.files.get('project/autosave/index.json')!)
  assert.ok(Array.isArray(index.entries)); assert.equal(runner.snapshot().retryCount, 0); assert.equal(runner.snapshot().pendingBytes, 0)
  assert.ok(typeof runner.snapshot().lastSuccessAt === 'string'); for (const key of opfs.files.keys()) assert.ok(!key.endsWith('.tmp'))
  assert.equal(meta?.source, 'current')
})

scenario('history rotation keeps at most 20 generations', async (_t, { initAutoSave, opfs }) => {
  const runner = initAutoSave(() => ({ nodes: [] } as any), { disabled: false })
  for (let i = 0; i < 22; i++) await runner.flushNow()
  assert.ok(Array.from(opfs.files.keys()).filter((k) => k.startsWith('project/autosave/history/')).length <= 20)
})

scenario('disabled guard returns no-op handle', async (_t: any, { initAutoSave, opfs }: any) => {
  const scope = globalThis as {
    __AUTOSAVE_ENABLED__?: boolean
    Day8Collector?: { publish: (event: any) => void }
  }
  const originalFlag = scope.__AUTOSAVE_ENABLED__
  const originalCollector = scope.Day8Collector
  for (const { flag, options, reason } of [
    { flag: false, options: { disabled: false }, reason: 'feature-flag-disabled' },
    { flag: true, options: { disabled: true }, reason: 'options-disabled' }
  ]) {
    const events: any[] = []
    scope.Day8Collector = { publish: (event: any) => events.push(event) }
    scope.__AUTOSAVE_ENABLED__ = flag
    try {
      const runner = initAutoSave(() => ({ nodes: [] } as any), options)
      assert.equal(runner.snapshot().phase, 'disabled')
      await assert.doesNotReject(() => runner.flushNow())
      await assert.doesNotReject(() => runner.dispose())
      assert.equal(runner.snapshot().phase, 'disabled')
      assert.equal(opfs.files.size, 0, `expected no writes, got keys: ${Array.from(opfs.files.keys()).join(', ')}`)
      assert.equal(events.length, 1, JSON.stringify(events))
      assert.equal(events[0]?.reason, reason)
      assert.equal(events[0]?.phase, 'disabled')
    } finally {
      if (originalFlag === undefined) {
        delete scope.__AUTOSAVE_ENABLED__
      } else {
        scope.__AUTOSAVE_ENABLED__ = originalFlag
      }
      if (originalCollector) {
        scope.Day8Collector = originalCollector
      } else {
        delete scope.Day8Collector
      }
      opfs.files.clear()
    }
  }
})

scenario(
  'lock failure surfaces AutoSaveError with retryable flag',
  { locks: { async request(){ throw new Error('denied') } } },
  async (_t, { initAutoSave }) => {
    const runner = initAutoSave(() => ({ nodes: [] } as any), { disabled: false })
    await assert.rejects(runner.flushNow(), (error: any) => error?.code === 'lock-unavailable' && error?.retryable === true)
  }
)
