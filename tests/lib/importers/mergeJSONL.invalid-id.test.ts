import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeJSONL } from '../../../src/lib/importers.ts'
import type { Storyboard } from '../../../src/types.ts'

test('mergeJSONL: id が欠落した行はスキップされる', () => {
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
      },
    ],
    selection: [],
    version: 1,
  }

  const payload = JSON.stringify({ text: 'no id' })

  const merged = mergeJSONL(before, `${payload}\n`, 'manual')

  assert.strictEqual(merged.scenes.length, 1)
  assert.strictEqual(merged.scenes[0].manual, 'before')
})

test('mergeJSONL: 文字列以外の id はスキップされる', () => {
  const before: Storyboard = {
    id: 'sb-1',
    title: 'demo',
    scenes: [],
    selection: [],
    version: 1,
  }

  const payload = JSON.stringify({ id: 123, text: 'bad id' })

  const merged = mergeJSONL(before, `${payload}\n`, 'manual')

  assert.strictEqual(merged.scenes.length, 0)
})
