import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeJSONL } from '../../../src/lib/importers.ts'
import type { Storyboard } from '../../../src/types.ts'

test('mergeJSONL: text が無い行で manual を維持する', () => {
  const before: Storyboard = {
    id: 'sb-1',
    title: 'demo',
    scenes: [
      {
        id: 'scene-1',
        manual: 'keep-manual',
        ai: 'keep-ai',
        status: 'idle',
        assets: [],
      },
    ],
    selection: [],
    version: 1,
  }

  const payload = JSON.stringify({ id: 'scene-1', seed: '42' })

  const merged = mergeJSONL(before, `${payload}\n`, 'manual')
  const scene = merged.scenes[0]

  assert.strictEqual(scene.manual, 'keep-manual')
  assert.strictEqual(scene.ai, 'keep-ai')
})

test('mergeJSONL: text が無い行で ai を維持する', () => {
  const before: Storyboard = {
    id: 'sb-1',
    title: 'demo',
    scenes: [
      {
        id: 'scene-1',
        manual: 'keep-manual',
        ai: 'keep-ai',
        status: 'idle',
        assets: [],
      },
    ],
    selection: [],
    version: 1,
  }

  const payload = JSON.stringify({ id: 'scene-1', tone: 'serious' })

  const merged = mergeJSONL(before, `${payload}\n`, 'ai')
  const scene = merged.scenes[0]

  assert.strictEqual(scene.manual, 'keep-manual')
  assert.strictEqual(scene.ai, 'keep-ai')
})
