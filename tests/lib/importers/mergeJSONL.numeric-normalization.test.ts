import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeJSONL } from '../../../src/lib/importers.ts'
import type { Scene, Storyboard } from '../../../src/types.ts'

test('mergeJSONL: 数値文字列を既存シーンへ正規化する', () => {
  const before: Storyboard = {
    id: 'sb-1',
    title: 'demo',
    scenes: [
      {
        id: 'scene-1',
        manual: 'before',
        ai: 'ai-before',
        status: 'idle',
        assets: [],
        seed: 11,
        take: 2,
        rating: 3,
      },
    ],
    selection: [],
    version: 1,
  }

  const payload = JSON.stringify({
    id: 'scene-1',
    text: 'after',
    seed: '101',
    take: '7',
    rating: '5',
  })

  const merged = mergeJSONL(before, `${payload}\n`, 'manual')
  const scene = merged.scenes[0]

  assert.strictEqual(scene.seed, 101)
  assert.strictEqual(scene.take, 7)
  assert.strictEqual(scene.rating, 5)
  assert.strictEqual(scene.manual, 'after')
  assert.strictEqual(scene.ai, 'ai-before', 'ai field should stay untouched in manual mode')
})

test('mergeJSONL: 数値文字列で新規シーンを作成すると rating も正規化される', () => {
  const before: Storyboard = {
    id: 'sb-1',
    title: 'demo',
    scenes: [],
    selection: [],
    version: 1,
  }

  const jsonl = [
    {
      id: 'scene-2',
      text: 'manual text',
      seed: '5',
      take: '9',
      rating: '4',
    },
    {
      id: 'scene-2',
      text: 'ai text',
      rating: '2',
    },
  ]
    .map((entry) => JSON.stringify(entry))
    .join('\n')

  const merged = mergeJSONL(before, `${jsonl}\n`, 'manual')
  const scene = merged.scenes.find((s: Scene) => s.id === 'scene-2')

  assert.ok(scene, 'scene-2 should be created')
  assert.strictEqual(scene?.seed, 5)
  assert.strictEqual(scene?.take, 9)
  assert.strictEqual(scene?.rating, 2)
  assert.strictEqual(scene?.manual, 'ai text')
})
