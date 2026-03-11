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

const sanitize = (ts: string): string => ts.replace(/[:.]/g, '-')

const EMPTY_INDEX = JSON.stringify({ current: null, history: [], generation: null })

scenario.skip(
  'AS-TDD-03: restoreFromCurrent surfaces data-corrupted for corrupted current payload',
  async (_t, ctx) => {
    const { opfs, restoreFromCurrent, restorePrompt, guardSnapshots, collectorEvents } = ctx

    opfs.files.set('project/autosave/index.json', EMPTY_INDEX)
    opfs.files.set('project/autosave/current.json', '{ invalid json }')

    await assert.rejects(
      () => restoreFromCurrent(),
      expectAutoSaveError({ code: 'data-corrupted', retryable: false })
    )

    const prompt = await restorePrompt()
    assert.equal(prompt, null)
    assert.deepEqual(guardSnapshots, [])
    assert.deepEqual(collectorEvents, [])
  }
)

scenario.skip(
  'AS-TDD-03: restoreFrom surfaces data-corrupted for corrupted history payload',
  async (_t, ctx) => {
    const { opfs, restoreFrom, restorePrompt, guardSnapshots, collectorEvents } = ctx

    opfs.files.set('project/autosave/index.json', EMPTY_INDEX)

    const ts = '2024-04-05T06:07:08.009Z'
    const sanitized = sanitize(ts)
    opfs.files.set(`project/autosave/history/${sanitized}.json`, '{ invalid history json }')

    await assert.rejects(
      () => restoreFrom(ts),
      expectAutoSaveError({ code: 'data-corrupted', retryable: false })
    )

    const prompt = await restorePrompt()
    assert.equal(prompt, null)
    assert.deepEqual(guardSnapshots, [])
    assert.deepEqual(collectorEvents, [])
  }
)
