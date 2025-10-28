import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeJSONL } from '../../../src/lib/importers.ts'
import type { Storyboard } from '../../../src/types.ts'

test('mergeJSONL: 既存シーンの文字列 seed/take を数値化する', () => {
  const before: Storyboard = {
    id: 'sb-1',
    title: 'demo',
    scenes: [
      {
        id: 'scene-1',
        manual: 'before',
        ai: '',
        status: 'idle',
        assets: [],
        seed: 111,
        take: 2,
      },
    ],
    selection: [],
    version: 1,
  }

  const payload = JSON.stringify({ id: 'scene-1', text: 'after', seed: '42', take: '7' })

  const merged = mergeJSONL(before, `${payload}\n`, 'manual')
  const scene = merged.scenes[0]

  assert.strictEqual(scene.seed, 42)
  assert.strictEqual(scene.take, 7)
  assert.strictEqual(scene.manual, 'after')
})

test('mergeJSONL: 新規シーンの文字列 seed/take を数値化する', () => {
  const before: Storyboard = {
    id: 'sb-1',
    title: 'demo',
    scenes: [],
    selection: [],
    version: 1,
  }

  const payload = JSON.stringify({ id: 'scene-2', text: 'new', seed: '5', take: '9' })

  const merged = mergeJSONL(before, `${payload}\n`, 'manual')
  const scene = merged.scenes.find((s) => s.id === 'scene-2')

  assert.ok(scene, 'scene-2 should be created')
  assert.strictEqual(scene?.seed, 5)
  assert.strictEqual(scene?.take, 9)
  assert.strictEqual(scene?.manual, 'new')
})
