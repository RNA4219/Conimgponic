import assert from 'node:assert/strict'
import test from 'node:test'

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MergeDock, planMergeDockTabs } from '../../src/components/MergeDock.tsx'
import type { FlagSnapshot } from '../../src/config/flags.ts'

type MergePrecision = Parameters<typeof planMergeDockTabs>[0]
type MergeDockTabPlan = ReturnType<typeof planMergeDockTabs>

const planTabsCases: readonly [
  name: string,
  precision: MergePrecision,
  lastTab: MergeDockTabPlan['initialTab'] | 'diff' | undefined,
  expectedTabs: readonly string[],
  expectedInitial: MergeDockTabPlan['initialTab'],
  verify?: (plan: MergeDockTabPlan) => void,
][] = [
  [
    'merge: legacy precision hides diff and keeps stored tab',
    'legacy',
    'shot',
    ['compiled', 'shot', 'assets', 'import', 'golden'],
    'shot',
  ],
  [
    'merge: legacy precision falls back when diff was last tab',
    'legacy',
    'diff',
    ['compiled', 'shot', 'assets', 'import', 'golden'],
    'compiled',
  ],
  [
    'merge: beta precision appends diff with badge and preserves initial tab',
    'beta',
    'assets',
    ['compiled', 'shot', 'assets', 'import', 'golden', 'diff'],
    'assets',
    (plan) => {
      const diffTab = plan.tabs[plan.tabs.length - 1]
      assert(diffTab, 'diff tab missing')
      assert.equal(diffTab.label, 'Diff (Beta)')
      assert.equal(diffTab.badge, 'Beta')
    },
  ],
  [
    'merge: stable precision inserts diff before golden and selects it initially',
    'stable',
    'shot',
    ['compiled', 'shot', 'assets', 'import', 'diff', 'golden'],
    'diff',
  ],
  [
    'merge: beta precision keeps diff when it was last tab',
    'beta',
    'diff',
    ['compiled', 'shot', 'assets', 'import', 'golden', 'diff'],
    'diff',
  ],
]

const diffPlanCases: readonly [
  name: string,
  precision: MergePrecision,
  expected: MergeDockTabPlan['diff'],
][] = [
  ['merge-ui: legacy precision exposes no diff plan', 'legacy', undefined],
  [
    'merge-ui: beta precision keeps diff opt-in',
    'beta',
    { exposure: 'opt-in', backupAfterMs: undefined },
  ],
  [
    'merge-ui: stable precision defaults to diff with backup window',
    'stable',
    { exposure: 'default', backupAfterMs: 5 * 60 * 1000 },
  ],
]

test('merge: tab plan snapshot', async (t) => {
  for (const [name, precision, lastTab, expectedTabs, expectedInitial, verify] of planTabsCases) {
    await t.test(name, () => {
      const plan = planMergeDockTabs(precision, lastTab)
      assert.deepEqual(
        plan.tabs.map((tab) => tab.id),
        expectedTabs,
        'tab ids mismatch',
      )
      assert.equal(plan.initialTab, expectedInitial, 'initial tab mismatch')
      verify?.(plan)
    })
  }
})

test('merge-ui: diff exposure plan', async (t) => {
  for (const [name, precision, expected] of diffPlanCases) {
    await t.test(name, () => {
      const plan = planMergeDockTabs(precision)
      if (!expected) {
        assert.equal(plan.diff, undefined)
        return
      }
      assert.ok(plan.diff, 'diff plan missing')
      assert.equal(plan.diff.exposure, expected.exposure)
      assert.equal(plan.diff.backupAfterMs, expected.backupAfterMs)
    })
  }
})

const stableFlags: FlagSnapshot = {
  autosave: { value: true, enabled: true, source: 'default', errors: [] },
  plugins: { value: false, enabled: false, source: 'default', errors: [] },
  merge: { value: 'stable', precision: 'stable', source: 'default', errors: [] },
  updatedAt: '2024-05-01T00:00:00.000Z',
}

test('merge-ui: stable precision diff tab renders DiffMergeView with backup CTA when autosave is stale', () => {
  const originalWindow = globalThis.window
  const originalDateNow = Date.now
  const store = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key) {
      return store.has(key) ? store.get(key)! : null
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key) {
      store.delete(key)
    },
    setItem(key, value) {
      store.set(key, value)
    },
  }
  const flushLog: string[] = []
  const mockWindow = {
    localStorage: storage,
    __mergeDockAutoSaveSnapshot: { lastSuccessAt: '2024-05-01T00:00:00.000Z' },
    __mergeDockFlushNow: () => {
      flushLog.push('flush')
    },
  } as typeof window & {
    __mergeDockAutoSaveSnapshot?: { lastSuccessAt?: string }
    __mergeDockFlushNow?: () => void
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: mockWindow,
  })
  Date.now = () => new Date('2024-05-01T00:10:01.000Z').getTime()

  try {
    const html = renderToStaticMarkup(
      React.createElement(MergeDock, {
        flags: {
          ...stableFlags,
          merge: { ...stableFlags.merge, value: 'stable', precision: 'stable' },
        },
        phaseStats: { reviewBandCount: 1, conflictBandCount: 1 },
      }),
    )

    assert.match(html, /data-component="diff-merge-view"/)
    assert.match(html, /data-testid="merge-dock-backup-cta"/)
    assert.equal(flushLog.length, 0)
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
    Date.now = originalDateNow
  }
})

test('merge-ui: beta precision diff tab reflects phase plan and keeps backup CTA gated', () => {
  const originalWindow = globalThis.window
  const originalDateNow = Date.now
  const store = new Map<string, string>()
  store.set('merge.lastTab', 'diff')
  const storage: Storage = {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key) {
      return store.has(key) ? store.get(key)! : null
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key) {
      store.delete(key)
    },
    setItem(key, value) {
      store.set(key, value)
    },
  }
  const mockWindow = {
    localStorage: storage,
    __mergeDockAutoSaveSnapshot: { lastSuccessAt: '2024-05-01T00:00:00.000Z' },
  } as typeof window & {
    __mergeDockAutoSaveSnapshot?: { lastSuccessAt?: string }
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: mockWindow,
  })
  Date.now = () => new Date('2024-05-01T00:10:01.000Z').getTime()

  try {
    const html = renderToStaticMarkup(
      React.createElement(MergeDock, {
        flags: {
          ...stableFlags,
          merge: { ...stableFlags.merge, value: 'beta', precision: 'beta' },
        },
        phaseStats: { reviewBandCount: 2, conflictBandCount: 0 },
      }),
    )

    assert.match(html, /data-component="diff-merge-view"/)
    assert.match(html, /data-merge-diff-enabled="true"/)
    assert.match(html, /data-merge-diff-exposure="opt-in"/)
    assert.doesNotMatch(html, /data-testid="merge-dock-backup-cta"/)
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
    Date.now = originalDateNow
  }
})
