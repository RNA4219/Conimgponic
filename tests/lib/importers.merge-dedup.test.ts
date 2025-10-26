import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeCSV, mergeJSONL } from '../../src/lib/importers.ts'
import type { Storyboard } from '../../src/types.ts'

test('mergeJSONL: 重複 id 行を単一シーンに集約する', () => {
  const before: Storyboard = {
    id: 'sb-1',
    title: 'demo',
    scenes: [],
    selection: [],
    version: 1,
  }

  const payload = [
    JSON.stringify({ id: 'scene-1', text: '初回', slate: 'A' }),
    JSON.stringify({ id: 'scene-1', text: '上書き', shot: 'B' }),
  ].join('\n')

  const merged = mergeJSONL(before, payload, 'manual')

  assert.equal(merged.scenes.length, 1, 'scene を 1 つに保つ')
  const scene = merged.scenes[0]
  assert.equal(scene.id, 'scene-1')
  assert.equal(scene.manual, '上書き')
  assert.equal(scene.ai, '')
  assert.equal(scene.slate, 'A')
  assert.equal(scene.shot, 'B')
})

test('mergeCSV: 重複 id 行を単一シーンに集約する', () => {
  const before: Storyboard = {
    id: 'sb-1',
    title: 'demo',
    scenes: [],
    selection: [],
    version: 1,
  }

  const csv = [
    'id,text,slate,shot,take',
    'scene-2,"first","S","SH",1',
    'scene-2,"second","S","SH",2',
  ].join('\n')

  const merged = mergeCSV(before, csv, 'ai')

  assert.equal(merged.scenes.length, 1, 'scene を 1 つに保つ')
  const scene = merged.scenes[0]
  assert.equal(scene.id, 'scene-2')
  assert.equal(scene.manual, '')
  assert.equal(scene.ai, 'second')
  assert.equal(scene.slate, 'S')
  assert.equal(scene.shot, 'SH')
  assert.equal(scene.take, 2)
})
