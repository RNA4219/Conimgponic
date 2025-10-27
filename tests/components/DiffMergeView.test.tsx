import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  DiffMergeView,
  createDiffMergeController,
  planDiffMergeView,
  resolveDiffMergeStoredTab,
  type DiffMergeQueueCommandPayload,
  type DiffMergeTabStorage,
  type MergeHunk,
} from '../../src/components/DiffMergeView.tsx'

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
  assert.match(html, /role="tablist"[^>]*data-precision="beta"/)
  assert.match(html, /data-testid="diff-merge-tab-diff"/)
  assert.match(html, /data-tab="diff"[^>]*aria-selected="false"/)
})

test('stable precision renders hunk selection controls per hunk', () => {
  const html = render('stable')
  assert.match(html, /data-testid="diff-merge-hunk-h1-toggle"/)
  assert.match(html, /data-hunk="h1"[^>]*aria-pressed="false"/)
})

test('beta precision surfaces queueMergeCommand action payloads', () => {
  const html = render('beta')
  assert.match(html, /data-testid="diff-merge-queue-selected"/)
  assert.match(html, /data-command="queue-merge"/)
  assert.match(html, /data-hunks="\[\]"/)
  assert.match(html, /data-testid="diff-merge-queue-selected"[\s\S]*?disabled/)
})

test('beta precision renders uniform layout sections', () => {
  const html = render('beta')
  assert.match(html, /data-block="navigation"/)
  assert.match(html, /data-block="hunk-list"/)
  assert.match(html, /data-block="operation-pane"/)
  assert.doesNotMatch(html, /data-block="edit-modal"/)
})

const storageKeyFor = (precision: 'legacy' | 'beta' | 'stable') => `diff-merge.lastTab.${precision}`

const createStorage = (initial: Record<string, string>): { storage: DiffMergeTabStorage; events: string[] } => {
  const data = new Map<string, string>(Object.entries(initial))
  const events: string[] = []
  const storage: DiffMergeTabStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      events.push(`set:${key}:${value}`)
      data.set(key, value)
    },
    removeItem: (key) => {
      events.push(`remove:${key}`)
      data.delete(key)
    },
  }
  return { storage, events }
}

test('resolveDiffMergeStoredTab persists fallback when stored tab is not allowed for precision', () => {
  const precision = 'stable'
  const plan = planDiffMergeView(precision)
  const key = storageKeyFor(precision)
  const { storage, events } = createStorage({ [key]: 'summary' })
  const resolved = resolveDiffMergeStoredTab({ plan, precision, storage, fallback: plan.initialTab })
  assert.equal(resolved, plan.initialTab)
  assert.deepEqual(events, [`remove:${key}`, `set:${key}:${plan.initialTab}`])
})

test('resolveDiffMergeStoredTab persists plan initial tab when fallback is not permitted for precision', () => {
  const precision = 'legacy'
  const plan = planDiffMergeView(precision)
  const key = storageKeyFor(precision)
  const { storage, events } = createStorage({ [key]: 'merged' })
  const resolved = resolveDiffMergeStoredTab({ plan, precision, storage, fallback: 'diff' })
  assert.equal(resolved, plan.initialTab)
  assert.deepEqual(events, [`remove:${key}`, `set:${key}:${plan.initialTab}`])
})

test('DiffMergeView queue telemetry captures the active tab selection', async () => {
  type DiffMergeController = ReturnType<typeof createDiffMergeController>
  const storageKey = storageKeyFor('stable')
  const { storage } = createStorage({ [storageKey]: 'merged' })
  const previousStorage = (globalThis as { localStorage?: DiffMergeTabStorage }).localStorage
  ;(globalThis as { localStorage?: DiffMergeTabStorage }).localStorage = storage

  const payloads: DiffMergeQueueCommandPayload[] = []
  let controller: DiffMergeController | undefined
  const previousHook = (globalThis as {
    __diffMergeViewOnControllerReady?: (instance: DiffMergeController) => void
  }).__diffMergeViewOnControllerReady
  ;(globalThis as {
    __diffMergeViewOnControllerReady?: (instance: DiffMergeController) => void
  }).__diffMergeViewOnControllerReady = (instance) => {
    controller = instance
  }

  const successEvent = {
    status: 'success',
    hunkIds: [],
    telemetry: {
      collectorSurface: 'diff-merge.hunk-list' as const,
      analyzerSurface: 'diff-merge.queue' as const,
      retryable: false,
    },
  }

  try {
    renderToStaticMarkup(
      <DiffMergeView
        precision="stable"
        hunks={sampleHunks}
        queueMergeCommand={async (payload) => {
          payloads.push(payload)
          return successEvent
        }}
      />,
    )

    assert.ok(controller)

    await controller?.queueMerge(['h1'])

    assert.equal(payloads.length, 1)
    assert.equal(payloads[0]?.telemetryContext.lastTab, 'merged')
  } finally {
    if (previousHook) {
      ;(globalThis as {
        __diffMergeViewOnControllerReady?: (instance: DiffMergeController) => void
      }).__diffMergeViewOnControllerReady = previousHook
    } else {
      delete (globalThis as {
        __diffMergeViewOnControllerReady?: (instance: DiffMergeController) => void
      }).__diffMergeViewOnControllerReady
    }

    if (previousStorage === undefined) {
      delete (globalThis as { localStorage?: DiffMergeTabStorage }).localStorage
    } else {
      ;(globalThis as { localStorage?: DiffMergeTabStorage }).localStorage = previousStorage
    }
  }
})
