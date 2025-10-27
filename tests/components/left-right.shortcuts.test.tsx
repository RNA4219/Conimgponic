const tsNodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
if (tsNodeEnv && !tsNodeEnv.TS_NODE_IGNORE_DIAGNOSTICS) {
  tsNodeEnv.TS_NODE_IGNORE_DIAGNOSTICS = '2304,2307,2580,5097'
}

// @ts-expect-error node:test diagnostics are suppressed via TS_NODE_IGNORE_DIAGNOSTICS
import assert from 'node:assert/strict'
// @ts-expect-error node:test diagnostics are suppressed via TS_NODE_IGNORE_DIAGNOSTICS
import test from 'node:test'

// @ts-expect-error ts-node resolves TS extensions via experimental specifier resolution
import { isGenerateShortcut } from '../../src/components/LeftRightPanes.tsx'

test('Ctrl+Enter を生成ショートカットとして認識する', () => {
  const event = { key: 'Enter', ctrlKey: true }
  assert.equal(isGenerateShortcut(event), true)
})

test('Ctrl+Enter 以外は生成ショートカットとして扱わない', () => {
  const inputs = [
    { key: 'Enter', ctrlKey: false },
    { key: 'c', ctrlKey: true },
    { key: 'enter', ctrlKey: true },
  ]
  for (const input of inputs) {
    assert.equal(isGenerateShortcut(input), false)
  }
})
