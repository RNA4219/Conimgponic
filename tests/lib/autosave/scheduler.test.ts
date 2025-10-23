import assert from 'node:assert/strict'

import { scenario } from './setup'

const flushAllTimers = async (t: import('node:test').TestContext) => {
  await Promise.resolve()
  t.mock.timers.runAll()
}

scenario('scheduler transitions debouncing → awaiting-lock → gc with fake timers', async (t, ctx) => {
  const { initAutoSave, AUTOSAVE_POLICY } = ctx as any
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'], now: 0 })
  const phases: string[] = []
  const collectorEvents: unknown[] = []
  const runner = initAutoSave(() => ({ nodes: [{ id: 'alpha' }] } as any), { disabled: false })
  phases.push(runner.snapshot().phase)
  const pending = runner.flushNow().catch((error: unknown) => {
    collectorEvents.push(error)
    throw error
  })
  t.mock.timers.tick(AUTOSAVE_POLICY.debounceMs)
  phases.push(runner.snapshot().phase)
  t.mock.timers.tick(AUTOSAVE_POLICY.idleMs)
  phases.push(runner.snapshot().phase)
  await pending.catch(() => undefined)
  await flushAllTimers(t)
  phases.push(runner.snapshot().phase)
  assert.deepEqual(phases, ['debouncing', 'awaiting-lock', 'gc', 'idle'])
  assert.equal(collectorEvents.length, 0)
})

scenario('markDirty transitions snapshot to debouncing and updates pendingBytes', async (_t, ctx) => {
  const { initAutoSave } = ctx as any
  const runner = initAutoSave(() => ({ nodes: [{ id: 'delta' }] } as any), { disabled: false })
  runner.markDirty({ pendingBytes: 2048 })
  const snap = runner.snapshot()
  assert.equal(snap.phase, 'debouncing')
  assert.equal(snap.pendingBytes, 2048)
})

scenario('history guard enforces 20 generations and 50MB capacity', async (_t, ctx) => {
  const { initAutoSave, opfs, AUTOSAVE_POLICY } = ctx as any
  const runner = initAutoSave(() => ({ nodes: [{ id: 'beta' }] } as any), { disabled: false })
  const collectorEvents: unknown[] = []
  for (let i = 0; i < AUTOSAVE_POLICY.maxGenerations + 2; i++){
    collectorEvents.push(await runner.flushNow().catch((error: unknown) => error))
  }
  const historyKeys = Array.from(opfs.files.keys() as IterableIterator<string>).filter((key) =>
    key.startsWith('project/autosave/history/')
  )
  const totalBytes = historyKeys.reduce<number>(
    (sum, key) => sum + Buffer.byteLength((opfs.files.get(key) as string | undefined) ?? '', 'utf8'),
    0
  )
  assert.equal(historyKeys.length, AUTOSAVE_POLICY.maxGenerations)
  assert.ok(totalBytes <= AUTOSAVE_POLICY.maxBytes)
  assert.ok(collectorEvents.every((entry) => entry === undefined))
})

scenario(
  'retryable errors trigger backoff before transitioning to disabled on fatal failure',
  { locks: { async request(){ throw Object.assign(new Error('simulated lock failure'), { code: 'lock-unavailable' }) } } },
  async (t, ctx) => {
    const { initAutoSave } = ctx as any
    t.mock.timers.enable({ apis: ['setTimeout'], now: Date.now() })
    const runner = initAutoSave(() => ({ nodes: [{ id: 'gamma' }] } as any), { disabled: false })
    await assert.rejects(runner.flushNow(), (error: any) => error?.code === 'lock-unavailable' && error?.retryable === true)
    t.mock.timers.tick(1000)
    assert.equal(runner.snapshot().phase, 'backoff')
    t.mock.timers.runAll()
    assert.equal(runner.snapshot().phase, 'disabled')
  }
)
