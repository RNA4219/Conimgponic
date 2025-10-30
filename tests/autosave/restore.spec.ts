import assert from 'node:assert/strict'

import { scenario } from '../lib/autosave/setup'

import type { AutoSaveError } from '../../src/lib/autosave'

const expectAutoSaveError = (
  expected: Pick<AutoSaveError, 'code' | 'retryable'>
): ((error: unknown) => error is AutoSaveError) =>
  (error: unknown): error is AutoSaveError => {
    if (!error || typeof error !== 'object') return false
    const candidate = error as Partial<AutoSaveError>
    return candidate.code === expected.code && candidate.retryable === expected.retryable
  }

const sanitizeTimestamp = (ts: string): string => ts.replace(/[:.]/g, '-')

scenario('restorePrompt throws data-corrupted when index payload is invalid JSON', async (_t, ctx) => {
  ctx.opfs.files.set('project/autosave/index.json', '{"invalid"')

  await assert.rejects(
    () => ctx.restorePrompt(),
    expectAutoSaveError({ code: 'data-corrupted', retryable: false })
  )

  assert.deepEqual(ctx.collectorEvents, [])
  assert.deepEqual(ctx.guardSnapshots, [])
})

scenario('restorePrompt returns null when no autosave metadata is present', async (_t, ctx) => {
  ctx.opfs.files.set('project/autosave/index.json', JSON.stringify({ history: [], current: null }))

  const result = await ctx.restorePrompt()

  assert.equal(result, null)
  assert.deepEqual(ctx.collectorEvents, [])
  assert.deepEqual(ctx.guardSnapshots, [])
})

scenario('restoreFromCurrent throws data-corrupted when current payload is invalid JSON', async (_t, ctx) => {
  ctx.opfs.files.set('project/autosave/current.json', '{"broken"')

  await assert.rejects(
    () => ctx.restoreFromCurrent(),
    expectAutoSaveError({ code: 'data-corrupted', retryable: false })
  )

  assert.deepEqual(ctx.collectorEvents, [])
  assert.deepEqual(ctx.guardSnapshots, [])
})

scenario('restoreFrom throws data-corrupted when history payload is invalid JSON', async (_t, ctx) => {
  const ts = '2024-04-05T06:07:08.009Z'
  const sanitized = sanitizeTimestamp(ts)
  ctx.opfs.files.set(`project/autosave/history/${sanitized}.json`, '{"oops"')

  await assert.rejects(
    () => ctx.restoreFrom(ts),
    expectAutoSaveError({ code: 'data-corrupted', retryable: false })
  )

  assert.deepEqual(ctx.collectorEvents, [])
  assert.deepEqual(ctx.guardSnapshots, [])
})
