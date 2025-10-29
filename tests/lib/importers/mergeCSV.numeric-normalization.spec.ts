import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeCSV } from '../../../src/lib/importers.ts'
import type { Storyboard } from '../../../src/types.ts'

test('mergeCSV.numeric-normalization: 非数値 take は新規シーンへ適用されない', () => {
  const before: Storyboard = {
    id: 'sb-1',
    title: 'demo',
    scenes: [],
    selection: [],
    version: 1,
  }

  const csv = [
    'id,text,take',
    'scene-1,"manual text","abc"',
  ].join('\n')

  const merged = mergeCSV(before, csv, 'manual')
  const scene = merged.scenes.find((s) => s.id === 'scene-1')

  assert.ok(scene, 'scene-1 should be created')
  assert.strictEqual(scene?.take, undefined)
  assert.strictEqual(scene?.manual, 'manual text')
  assert.strictEqual(scene?.ai, '')
})
