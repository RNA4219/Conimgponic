/// <reference types="node" />

const tsNodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
if (tsNodeEnv) {
  tsNodeEnv.TS_NODE_IGNORE_DIAGNOSTICS = '2304,2307,2578,2580,5097'
}

import assert from 'node:assert/strict'
import test from 'node:test'

import type { Storyboard } from '../../src/types'

const mergeDockModule = await import('../../src/components/MergeDock')

const { mergeMarkdownStoryboard, resolveMergeDockImportKind } = mergeDockModule as typeof mergeDockModule & {
  mergeMarkdownStoryboard?: (
    current: Storyboard,
    markdown: string,
    mode: 'manual' | 'ai',
  ) => Storyboard
  resolveMergeDockImportKind?: (fileName: string) => 'jsonl' | 'csv' | 'markdown' | null
}

test('MergeDock mergeMarkdownStoryboard updates scenes when markdown starts with a cut heading containing CRLF', () => {
  assert.ok(
    mergeMarkdownStoryboard,
    'Day8/workflow-cookbook/GUARDRAILS.md と Day8/docs/day8/guides/07_contributing.md の最小差分原則に従い、Markdown インポートヘルパーをエクスポートする',
  )

  const base: Storyboard = {
    id: 'sb-merge-crlf',
    title: 'Storyboard',
    scenes: [
      { id: 'cut-1', manual: 'original manual 1', ai: 'original ai 1', status: 'idle', assets: [] },
      { id: 'cut-2', manual: 'original manual 2', ai: 'original ai 2', status: 'idle', assets: [] },
    ],
    selection: [],
    version: 1,
  }

  const markdown = [
    '## Cut 1',
    'Manual line 1',
    'Manual line 1b',
    '',
    '## Cut 2',
    'Manual line 2',
  ].join('\r\n')

  const imported = mergeMarkdownStoryboard!(base, markdown, 'manual')

  assert.equal(imported.scenes[0]?.manual, 'Manual line 1\nManual line 1b')
  assert.equal(imported.scenes[1]?.manual, 'Manual line 2')
  assert.equal(imported.scenes[0]?.ai, 'original ai 1')
  assert.equal(imported.scenes[1]?.ai, 'original ai 2')
})

// RED: スペース付き見出しをセパレーターとして扱う
test('MergeDock mergeMarkdownStoryboard handles headings prefixed with spaces as separators', () => {
  assert.ok(
    mergeMarkdownStoryboard,
    'Day8/workflow-cookbook/GUARDRAILS.md「実装時はテスト駆動開発を基本とし、テストを先に記述する。」と Day8/docs/day8/guides/07_contributing.md「1タスク=1ブランチ=1PR（±300行/≤3ファイルを目安）」を引用し、スペース付き見出しの RED ケースを追加する',
  )

  const base: Storyboard = {
    id: 'sb-merge-leading-space',
  }
})

// RED: インデント付き見出しの切り出しをテスト
test('MergeDock mergeMarkdownStoryboard imports scenes even when cut headings are indented', () => {
  assert.ok(
    mergeMarkdownStoryboard,
    'Day8/workflow-cookbook/HUB.codex.md のタスク化手順と Day8/docs/TASKS.md の順守を確認するため、インデント付き見出しの RED テストを先に定義する',
  )

  const base: Storyboard = {
    id: 'sb-merge-leading-space-heading',
  }
})

    title: 'Storyboard',
    scenes: [
      { id: 'cut-1', manual: 'original manual 1', ai: 'original ai 1', status: 'idle', assets: [] },
      { id: 'cut-2', manual: 'original manual 2', ai: 'original ai 2', status: 'idle', assets: [] },
    ],
    selection: [],
    version: 1,
  }

  const markdown = [
    '  ## Cut 1',
    'Manual line 1',
    '',
    '\t## Cut 2',
    'Manual line 2',
  ].join('\n')

  const imported = mergeMarkdownStoryboard!(base, markdown, 'manual')

  assert.equal(imported.scenes[0]?.manual, 'Manual line 1')
  assert.equal(imported.scenes[1]?.manual, 'Manual line 2')
  assert.equal(imported.scenes[0]?.ai, 'original ai 1')
  assert.equal(imported.scenes[1]?.ai, 'original ai 2')
})

test('MergeDock resolveMergeDockImportKind accepts uppercase storyboard import extensions', () => {
  assert.ok(
    resolveMergeDockImportKind,
    'Day8/workflow-cookbook/GUARDRAILS.md の「テスト駆動」を守り、MergeDock のインポート判定を事前に RED 化する',
  )

  assert.equal(resolveMergeDockImportKind!('update.JSONL'), 'jsonl')
  assert.equal(resolveMergeDockImportKind!('update.CSV'), 'csv')
  assert.equal(resolveMergeDockImportKind!('update.MD'), 'markdown')
})

test('MergeDock mergeMarkdownStoryboard strips inline multi-line HTML comments without leaking fragments', () => {
  assert.ok(
    mergeMarkdownStoryboard,
    'Day8/workflow-cookbook/GUARDRAILS.md「実装時はテスト駆動開発を基本とし、テストを先に記述する。」と Day8/docs/day8/guides/07_contributing.md「1タスク=1ブランチ=1PR」を引用し、Markdown コメント除去の RED ケースを先に定義する',
  )

  const base: Storyboard = {
    id: 'sb-merge-inline-comment',
    title: 'Storyboard',
    scenes: [
      { id: 'cut-1', manual: '', ai: '', status: 'idle', assets: [] },
      { id: 'cut-2', manual: '', ai: '', status: 'idle', assets: [] },
    ],
    selection: [],
    version: 1,
  }

  const markdown = [
    '## Cut 1',
    'Manual before <!-- comment line 1',
    'comment line 2 --> manual after',
    '',
    '## Cut 2',
    'Manual line 2',
  ].join('\r\n')

  const imported = mergeMarkdownStoryboard!(base, markdown, 'manual')

  const manual = imported.scenes[0]?.manual ?? ''
  assert.ok(!manual.includes('comment line 1'))
  assert.ok(!manual.includes('comment line 2'))
  assert.equal(imported.scenes[0]?.manual, 'Manual before manual after')
  assert.equal(imported.scenes[1]?.manual, 'Manual line 2')
})
