import assert from 'node:assert/strict'

import { ENABLED_GUARD, scenario } from './setup'

import type { Storyboard } from '../../../src/types'

const createDeferredLockOverrides = () => {
  const resumes: Array<() => Promise<void>> = []
  return {
    overrides: {
      locks: {
        async request(
          _name: string,
          _options: { signal?: AbortSignal },
          callback: (lock: { release(): Promise<void> }) => Promise<unknown>
        ) {
          const handle = { async release() {} }
          return new Promise<typeof handle>((resolve, reject) => {
            resumes.push(async () => {
              try {
                await callback(handle)
                resolve(handle)
              } catch (error) {
                reject(error)
              }
            })
          })
        }
      }
    },
    resumes
  }
}

const makeStoryboard = (nodes: string[]): Storyboard => ({
  id: 'storyboard',
  title: 'Storyboard',
  scenes: nodes.map((id) => ({ id, manual: '', ai: '', status: 'idle', assets: [] })),
  selection: [],
  version: 1
})

const deferredLock = createDeferredLockOverrides()
const chainedLock = createDeferredLockOverrides()

scenario.skip(
  'pending queue retains dirty entries raised during in-flight flush and schedules follow-up write',
  deferredLock.overrides,
  async (t, ctx) => {
    const { initAutoSave, AUTOSAVE_POLICY, opfs } = ctx
    deferredLock.resumes.length = 0
    t.mock.timers.enable({ apis: ['setTimeout'], now: 0 })
    let sceneCount = 1
    const runner = initAutoSave(
      () => makeStoryboard(Array.from({ length: sceneCount }, (_, index) => `scene-${index + 1}`)),
      { disabled: false },
      ENABLED_GUARD
    )

    const waitForResume = async (): Promise<() => Promise<void>> => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const resume = deferredLock.resumes.shift()
        if (resume) {
          return resume
        }
        await Promise.resolve()
      }
      assert.fail('expected project lock request during flush')
    }

    const waitForSettledPhase = async (): Promise<string> => {
      for (let attempt = 0; attempt < 1000; attempt += 1) {
        const { phase } = runner.snapshot()
        if (!['awaiting-lock', 'writing-current', 'updating-index', 'gc'].includes(phase)) {
          return phase
        }
        await Promise.resolve()
      }
      return runner.snapshot().phase
    }

    runner.markDirty({ pendingBytes: 1024 })
    t.mock.timers.tick(AUTOSAVE_POLICY.debounceMs)
    await Promise.resolve()
    t.mock.timers.tick(AUTOSAVE_POLICY.idleMs)
    await Promise.resolve()
    const firstResume = await waitForResume()
    sceneCount = 2
    runner.markDirty({ pendingBytes: 2048 })
    await firstResume()
    const midPhase = await waitForSettledPhase()
    const midSnapshot = runner.snapshot()
    assert.equal(midPhase, 'dirty')
    assert.equal(midSnapshot.queuedGeneration, 1)

    t.mock.timers.tick(AUTOSAVE_POLICY.debounceMs)
    await Promise.resolve()
    t.mock.timers.tick(AUTOSAVE_POLICY.idleMs)
    await Promise.resolve()
    const secondResume = await waitForResume()
    await secondResume()
    const finalPhase = await waitForSettledPhase()

    const historyKeys = Array.from(opfs.files.keys()).filter((key) =>
      key.startsWith('project/autosave/history/')
    )
    assert.equal(historyKeys.length, 2)
    const finalSnapshot = runner.snapshot()
    assert.equal(finalPhase, 'idle')
    assert.equal(finalSnapshot.queuedGeneration ?? 0, 0)
  }
)

scenario.skip(
  'auto flush resumes after first write when additional dirty events arrive mid-flight',
  chainedLock.overrides,
  async (t, ctx) => {
    const { initAutoSave, AUTOSAVE_POLICY, opfs } = ctx
    chainedLock.resumes.length = 0
    t.mock.timers.enable({ apis: ['setTimeout'], now: 0 })
    let sceneCount = 1
    const runner = initAutoSave(
      () => makeStoryboard(Array.from({ length: sceneCount }, (_, index) => `scene-${index + 1}`)),
      { disabled: false },
      ENABLED_GUARD
    )

    const waitForResume = async (): Promise<() => Promise<void>> => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const resume = chainedLock.resumes.shift()
        if (resume) {
          return resume
        }
        await Promise.resolve()
      }
      assert.fail('expected project lock request during flush')
    }

    const awaitPhase = async (expected: string): Promise<void> => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const snapshot = runner.snapshot()
        if (snapshot.phase === expected) {
          return
        }
        await Promise.resolve()
      }
      const snapshot = runner.snapshot()
      assert.equal(snapshot.phase, expected, `expected phase ${expected}, received ${snapshot.phase}`)
    }

    runner.markDirty({ pendingBytes: 512 })
    t.mock.timers.tick(AUTOSAVE_POLICY.debounceMs)
    await Promise.resolve()
    t.mock.timers.tick(AUTOSAVE_POLICY.idleMs)
    await Promise.resolve()

    const firstResume = await waitForResume()

    sceneCount = 2
    runner.markDirty({ pendingBytes: 1536 })

    await firstResume()
    await awaitPhase('debouncing')
    const midSnapshot = runner.snapshot()
    assert.equal(midSnapshot.queuedGeneration, 1)

    t.mock.timers.tick(AUTOSAVE_POLICY.debounceMs)
    await Promise.resolve()
    t.mock.timers.tick(AUTOSAVE_POLICY.idleMs)
    await Promise.resolve()

    const secondResume = await waitForResume()
    await secondResume()
    await awaitPhase('idle')

    const historyKeys = Array.from(opfs.files.keys()).filter((key) =>
      key.startsWith('project/autosave/history/')
    )
    assert.equal(historyKeys.length, 2)
    const finalSnapshot = runner.snapshot()
    assert.equal(finalSnapshot.phase, 'idle')
    assert.equal(finalSnapshot.queuedGeneration ?? 0, 0)
  }
)

scenario.skip('queuedGeneration increments per flush and persists across gc rotation', async (t, ctx) => {
  const { initAutoSave, AUTOSAVE_POLICY, opfs } = ctx
  let sceneCount = 1
  const runner = initAutoSave(
    () => makeStoryboard(Array.from({ length: sceneCount }, (_, index) => `scene-${index + 1}`)),
    { disabled: false },
    ENABLED_GUARD
  )

  assert.equal(runner.snapshot().queuedGeneration ?? 0, 0)

  const committed: number[] = []
  const totalFlushes = AUTOSAVE_POLICY.maxGenerations + 3
  for (let expectedGeneration = 0; expectedGeneration < totalFlushes; expectedGeneration += 1) {
    sceneCount += 1
    runner.markDirty({ pendingBytes: 1024 + expectedGeneration })
    const dirtySnapshot = runner.snapshot()
    assert.equal(
      dirtySnapshot.queuedGeneration ?? 0,
      expectedGeneration,
      'queuedGeneration should expose the next commit generation before flush'
    )

    await runner.flushNow()

    const indexPayload = opfs.files.get('project/autosave/index.json')
    assert.ok(indexPayload, 'index.json must be written after flush')
    const parsed = JSON.parse(indexPayload)
    const storedGeneration = parsed?.generation
    assert.equal(storedGeneration, expectedGeneration, 'index.json should persist last committed generation')
    committed.push(storedGeneration)

    const postFlushSnapshot = runner.snapshot()
    assert.equal(postFlushSnapshot.queuedGeneration ?? 0, 0)
  }

  for (let i = 1; i < committed.length; i += 1) {
    assert.ok(
      committed[i]! > committed[i - 1]!,
      'committed generations should increase monotonically'
    )
  }

  const finalIndex = JSON.parse(opfs.files.get('project/autosave/index.json')!)
  assert.ok(finalIndex.history.length <= AUTOSAVE_POLICY.maxGenerations)
  assert.equal(finalIndex.generation, committed.at(-1))
})
