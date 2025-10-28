import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeJSONL } from '../../../src/lib/importers.ts'
import type { Storyboard } from '../../../src/types.ts'

test('mergeJSONL: id が欠落・非文字列の行は無視する', () => {
  const before: Storyboard = {
    id: 'sb-1',
    title: 'demo',
    scenes: [],
    selection: [],
    version: 1,
  }

  const payload = [
    JSON.stringify({ text: 'idなし' }),
    JSON.stringify({ id: 123, text: 'id数値' }),
  ].join('\n')

  const merged = mergeJSONL(before, payload, 'manual')

  assert.equal(merged.scenes.length, 0, '無効行ではシーンを追加しない')
})
