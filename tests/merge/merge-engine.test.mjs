import { register } from 'node:module'
await register(new URL('./ts-loader.mjs', import.meta.url).href, import.meta.url)

import test from 'node:test'
import assert from 'node:assert/strict'

const { DEFAULT_MERGE_ENGINE } = await import('../../src/lib/merge.ts')

function runMerge(input, options) {
  return DEFAULT_MERGE_ENGINE.merge3(input, options)
}

test('legacy precision with identical ours/theirs resolves all sections automatically', () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'legacy'

  const input = {
    base: 'Line A\n\nLine B',
    ours: 'Line A\n\nLine B',
    theirs: 'Line A\n\nLine B',
    sceneId: 'scene-auto',
  }

  const result = runMerge(input, { profile: { threshold: 0.6 } })

  assert.equal(result.hunks.length, 2)
  result.hunks.forEach((hunk) => {
    assert.equal(hunk.decision, 'auto')
    assert.equal(hunk.similarity, 1)
  })
  assert.equal(result.stats.autoDecisions, result.hunks.length)
  assert.equal(result.stats.conflictDecisions, 0)

  process.env.MERGE_PRECISION = originalPrecision
})

test('beta precision marks low-similarity section as conflict and emits event', () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'beta'

  const published = []
  const input = {
    base: 'Shared intro\n\nCommon body',
    ours: 'Shared intro\n\nManual body update',
    theirs: 'Shared intro\n\nAI alternative conclusion',
    sceneId: 'scene-conflict',
  }

  const result = runMerge(input, {
    events: {
      publish: (event) => published.push(event),
      subscribe: () => () => undefined,
    },
  })

  assert.equal(result.hunks.length, 2)
  const conflictHunks = result.hunks.filter((h) => h.decision === 'conflict')
  assert.equal(conflictHunks.length, 1)
  assert.equal(conflictHunks[0]?.section, 'section-2')
  assert.equal(result.stats.conflictDecisions, 1)
  assert.ok(published.some((event) => event.type === 'merge:conflict-detected'))

  process.env.MERGE_PRECISION = originalPrecision
})

test('locks force conflict decision regardless of similarity', () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'stable'

  const lockMap = new Map([['section-1', 'manual']])
  const input = {
    base: 'Intro text',
    ours: 'Intro text',
    theirs: 'Intro text',
    locks: lockMap,
    sceneId: 'scene-lock',
  }

  const result = runMerge(input)
  assert.equal(result.hunks.length, 1)
  const [hunk] = result.hunks
  assert.equal(hunk.decision, 'conflict')
  assert.equal(hunk.prefer, 'manual')
  assert.equal(result.stats.lockedDecisions, 1)

  process.env.MERGE_PRECISION = originalPrecision
})

test('telemetry sink receives ordered lifecycle events with processing stats', () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'legacy'

  const telemetryCalls = []
  const input = {
    base: 'A',
    ours: 'A',
    theirs: 'A',
    sceneId: 'scene-telemetry',
  }

  const result = runMerge(input, {
    telemetry: (event) => {
      telemetryCalls.push(event.type)
      if (event.type === 'merge:finish') {
        assert.ok(event.stats)
        assert.ok((event.stats?.processingMillis ?? 0) >= 0)
      }
    },
  })

  assert.deepEqual(telemetryCalls, ['merge:start', 'merge:hunk-decision', 'merge:finish'])
  assert.ok(result.stats.processingMillis >= 0)

  process.env.MERGE_PRECISION = originalPrecision
})
