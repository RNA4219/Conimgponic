import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeCSV } from '../../../src/lib/importers.ts'
import type { Storyboard } from '../../../src/types.ts'

test('mergeCSV.quote-trimming: 二重引用符を除去し制御文字を展開する', () => {
  const before: Storyboard = {
    id: 'sb-quote',
    title: 'quote-trim',
    scenes: [],
    selection: [],
    version: 1,
  }

  const csv = [
    'id,text,tone,slate,shot,take',
    '"scene-quote","line with \\n newline","Calm tone","Slate-1","Shot-1","7"',
  ].join('\n')

  const merged = mergeCSV(before, csv, 'manual')
  const scene = merged.scenes.find((s) => s.id === 'scene-quote')
  const expectedManual = 'line with \\n newline'.replace(/\\n/g, '\n')

  assert.ok(scene, 'scene-quote should be created')
  assert.strictEqual(scene?.id, 'scene-quote')
  assert.strictEqual(scene?.manual, expectedManual)
  assert.strictEqual(scene?.tone, 'Calm tone')
  assert.strictEqual(scene?.slate, 'Slate-1')
  assert.strictEqual(scene?.shot, 'Shot-1')
  assert.strictEqual(scene?.take, 7)
  assert.strictEqual(scene?.ai, '')
})
