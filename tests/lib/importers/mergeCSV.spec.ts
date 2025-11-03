import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeCSV } from '../../../src/lib/importers.ts'
import type { Storyboard } from '../../../src/types.ts'

// Guardrails (Day8/workflow-cookbook/GUARDRAILS.md): TDD で先に RED ケースを追加する。
// Contributing (Day8/docs/day8/guides/07_contributing.md): 1PR 原則に従い本タスク専用の検証を行う。

test('mergeCSV: text 列欠如時は既存本文を保持する', () => {
  const before: Storyboard = {
    id: 'sb-1',
    title: 'demo',
    scenes: [
      {
        id: 'scene-1',
        manual: '既存マニュアル',
        ai: '既存AI',
        status: 'idle',
        assets: [],
      },
    ],
    selection: [],
    version: 1,
  }

  const csv = [
    'id,slate,shot,take',
    'scene-1,S,SH,3',
  ].join('\n')

  const merged = mergeCSV(before, csv, 'manual')

  assert.equal(merged.scenes.length, 1)
  const scene = merged.scenes[0]
  assert.equal(scene.manual, '既存マニュアル', 'text 列が無い場合は manual を維持する')
  assert.equal(scene.ai, '既存AI', 'text 列欠如は ai に影響しない')
  assert.equal(scene.slate, 'S')
  assert.equal(scene.shot, 'SH')
  assert.equal(scene.take, 3)
})
