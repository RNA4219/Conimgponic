import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeJSONL } from '../../../src/lib/importers.ts'
import type { Storyboard } from '../../../src/types.ts'

test('mergeJSONL: id が欠落した行は無視される', () => {
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

  const payload = JSON.stringify({ text: 'no-id' })

  const merged = mergeJSONL(before, `${payload}\n`, 'manual')

  assert.strictEqual(merged.scenes.length, 1)
  assert.strictEqual(merged.scenes[0].manual, 'before')
})

test('mergeJSONL: 文字列以外の id は無視される', () => {
  const before: Storyboard = {
    id: 'sb-1',
    title: 'demo',
    scenes: [],
    selection: [],
    version: 1,
  }

  const invalidIdLine = JSON.stringify({ id: 123, text: 'invalid' })
  const blankIdLine = JSON.stringify({ id: '   ', text: 'blank' })

  const merged = mergeJSONL(before, `${invalidIdLine}\n${blankIdLine}\n`, 'manual')

  assert.strictEqual(merged.scenes.length, 0)
})
