import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { DiffMergeView, type DiffMergeViewProps } from '../../src/components/DiffMergeView.tsx'
import {
  createDiffMergeNavigationKeyHandler,
  planDiffMergeView,
  resolveDiffMergeStoredTab,
  type DiffMergeQueueCommandPayload,
  type DiffMergeSubTabKey,
  type DiffMergeTabStorage,
  type MergeHunk,
} from '../../src/components/diffMergeTypes.ts'
import { createDiffMergeController } from '../../src/components/diffMergeState'

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

const queueMergeCommand: DiffMergeViewProps['queueMergeCommand'] = async () => ({
  status: 'success' as const,
  hunkIds: [],
  telemetry: {
    collectorSurface: 'diff-merge.hunk-list' as const,
    analyzerSurface: 'diff-merge.queue' as const,
    retryable: false,
  },
})

const render = (
  precision: 'legacy' | 'beta' | 'stable',
  overrides: Partial<Omit<DiffMergeViewProps, 'precision'>> = {},
) =>
  renderToStaticMarkup(
    <DiffMergeView
      precision={precision}
      hunks={sampleHunks}
      queueMergeCommand={queueMergeCommand}
      {...overrides}
    />,
  )

test('disabled mode renders inert diff merge placeholder', () => {
  const html = render('beta', { disabled: true })
  assert.match(html, /data-component="diff-merge-view"/)
  assert.match(html, /data-block="diff-merge-disabled"/)
  assert.match(html, /aria-disabled="true"/)
  assert.doesNotMatch(html, /role="tablist"/)
})

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

test('beta precision renders manual hunk selection controls with pressed state', () => {
  const html = render('beta')
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

test('legacy precision navigation retains review tab order for arrow keys', () => {
  const plan = planDiffMergeView('legacy')
  const tabs = plan.tabs.map((tab) => tab.key)
  assert.deepEqual(tabs, ['review'])

  let active: DiffMergeSubTabKey = plan.initialTab
  const selected: DiffMergeSubTabKey[] = []
  const handler = createDiffMergeNavigationKeyHandler({
    tabs,
    resolveActive: () => active,
    onSelect: (key) => {
      selected.push(key)
      active = key
    },
  })

  const simulate = (key: 'ArrowLeft' | 'ArrowRight') => {
    let prevented = false
    handler({
      key,
      preventDefault: () => {
        prevented = true
      },
    } as unknown as React.KeyboardEvent<HTMLDivElement>)
    return prevented
  }

  assert.equal(active, 'review')
  assert.equal(simulate('ArrowRight'), true)
  assert.equal(simulate('ArrowLeft'), true)
  assert.deepEqual(selected, [])
  assert.equal(active, 'review')
})

test('stable precision navigation cycles tabs with arrow keys', () => {
  // Guardrails: HUB.codex.md と TASKS.md の TDD 要求を引用し、ArrowLeft/Right の
  // キー操作シミュレーションで DiffMergeSubTabKey が循環することを赤テストで
  // 先に固定する。
  const plan = planDiffMergeView('stable')
  const tabs = plan.tabs.map((tab) => tab.key)
  let active: DiffMergeSubTabKey = plan.initialTab
  const selected: DiffMergeSubTabKey[] = []
  const handler = createDiffMergeNavigationKeyHandler({
    tabs,
    resolveActive: () => active,
    onSelect: (key) => {
      selected.push(key)
      active = key
    },
  })

  const simulate = (key: 'ArrowLeft' | 'ArrowRight') => {
    let prevented = false
    handler({
      key,
      preventDefault: () => {
        prevented = true
      },
    } as unknown as React.KeyboardEvent<HTMLDivElement>)
    return prevented
  }

  assert.equal(active, 'diff')
  assert.equal(simulate('ArrowRight'), true)
  assert.deepEqual(selected, ['merged'])
  assert.equal(active, 'merged')

  assert.equal(simulate('ArrowRight'), true)
  assert.deepEqual(selected, ['merged', 'review'])
  assert.equal(active, 'review')

  assert.equal(simulate('ArrowRight'), true)
  assert.deepEqual(selected, ['merged', 'review', 'diff'])
  assert.equal(active, 'diff')

  assert.equal(simulate('ArrowLeft'), true)
  assert.deepEqual(selected, ['merged', 'review', 'diff', 'review'])
  assert.equal(active, 'review')

  assert.equal(simulate('ArrowLeft'), true)
  assert.deepEqual(selected, ['merged', 'review', 'diff', 'review', 'merged'])
  assert.equal(active, 'merged')

  const prevented = handler({
    key: 'Enter',
    preventDefault: () => {
      throw new Error('should not prevent default for Enter key')
    },
  } as unknown as React.KeyboardEvent<HTMLDivElement>)
  assert.equal(prevented, undefined)
  assert.deepEqual(selected, ['merged', 'review', 'diff', 'review', 'merged'])
  assert.equal(active, 'merged')
})

test('beta precision diff tab preserves navigation shortcuts and controls', () => {
  const plan = planDiffMergeView('beta')
  const tabs = plan.tabs.map((tab) => tab.key)
  assert.deepEqual(tabs, ['review', 'diff', 'merged'])

  let active: DiffMergeSubTabKey = plan.initialTab
  const selected: DiffMergeSubTabKey[] = []
  const handler = createDiffMergeNavigationKeyHandler({
    tabs,
    resolveActive: () => active,
    onSelect: (key) => {
      selected.push(key)
      active = key
    },
  })

  const simulate = (key: 'ArrowLeft' | 'ArrowRight') => {
    let prevented = false
    handler({
      key,
      preventDefault: () => {
        prevented = true
      },
    } as unknown as React.KeyboardEvent<HTMLDivElement>)
    return prevented
  }

  assert.equal(active, 'review')
  assert.equal(simulate('ArrowRight'), true)
  assert.deepEqual(selected, ['diff'])
  assert.equal(active, 'diff')

  assert.equal(simulate('ArrowLeft'), true)
  assert.deepEqual(selected, ['diff', 'review'])
  assert.equal(active, 'review')

  const html = render('beta')
  assert.match(html, /aria-keyshortcuts="ArrowLeft ArrowRight"/)
  assert.match(html, /data-testid="diff-merge-tab-review"/)
  assert.match(html, /data-testid="diff-merge-tab-diff"/)
  assert.match(html, /data-testid="diff-merge-hunk-h1-toggle"/)
  assert.match(html, /data-testid="diff-merge-queue-selected"/)
})

test('diff merge navigation exposes arrow key shortcuts across precisions', () => {
  for (const precision of ['legacy', 'beta', 'stable'] as const) {
    const html = render(precision)
    assert.match(html, /role="tablist"[^>]*aria-keyshortcuts="ArrowLeft ArrowRight"/)
  }
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

test('resolveDiffMergeStoredTab ignores storage persistence errors while keeping selection', () => {
  const precision = 'stable' as const
  const plan = planDiffMergeView(precision)
  const key = storageKeyFor(precision)
  const events: string[] = []
  const storage: DiffMergeTabStorage = {
    getItem: () => 'summary',
    setItem: () => {
      events.push(`set:${key}:diff`)
      throw new Error('persist-failed')
    },
    removeItem: (target) => {
      events.push(`remove:${target}`)
    },
  }

  const resolved = resolveDiffMergeStoredTab({ plan, precision, storage, fallback: plan.initialTab })

  assert.equal(resolved, plan.initialTab)
  assert.deepEqual(events, [`remove:${key}`, `set:${key}:diff`])
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
    status: 'success' as const,
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
