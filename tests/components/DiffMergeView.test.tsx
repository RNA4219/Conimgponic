import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { DiffMergeView, type MergeHunk } from '../../src/components/DiffMergeView.tsx'

const sampleHunks: readonly MergeHunk[] = [
  {
    id: 'h1',
    section: 'scene-001',
    decision: 'conflict',
    similarity: 0.42,
    merged: '<merged />',
    manual: '<manual />',
    ai: '<ai />',
    base: '<base />',
    prefer: 'none',
  },
]

const render = (precision: 'legacy' | 'beta' | 'stable') =>
  renderToStaticMarkup(
    <DiffMergeView
      precision={precision}
      hunks={sampleHunks}
      queueMergeCommand={async () => ({ status: 'success', hunkIds: [], telemetry: { collectorSurface: 'diff-merge.hunk-list', analyzerSurface: 'diff-merge.queue', retryable: false } })}
    />,
  )

test('precision beta exposes diff tab with accessible roles', () => {
  const html = render('beta')
  assert.match(html, /role="tablist" data-precision="beta"/)
  assert.match(html, /data-testid="diff-merge-tab-diff"/)
  assert.match(html, /aria-selected="false" data-tab="diff"/)
})

test('stable precision renders hunk selection controls per hunk', () => {
  const html = render('stable')
  assert.match(html, /data-testid="diff-merge-hunk-h1-toggle"/)
  assert.match(html, /aria-pressed="false" data-hunk="h1"/)
})

test('stable precision surfaces queueMergeCommand action payloads', () => {
  const html = render('stable')
  assert.match(html, /data-testid="diff-merge-queue-selected"/)
  assert.match(html, /data-command="queue-merge"/)
  assert.match(html, /data-hunks="\[\&quot;h1\&quot;\]"/)
})
