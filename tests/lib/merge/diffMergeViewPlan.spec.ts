import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DIFF_MERGE_TAB_STORAGE_PREFIX,
  createDiffMergeNavigationKeyHandler,
  diffMergeViewDesign,
  planDiffMergeSubTabs,
  planDiffMergeView,
  resolveDiffMergeStoredTab,
  type DiffMergeSubTabKey,
  type DiffMergeTabStorage,
} from '../../../src/lib/merge/diffMergePlan.ts'


test('diffMerge plan exposes precision specific layouts and badges', () => {
  const legacy = planDiffMergeView('legacy')
  assert.deepEqual(legacy, {
    precision: 'legacy',
    phase: 'phase-a',
    tabs: [
      { key: 'review', label: 'Review', panes: ['hunk-list'], badge: undefined },
    ],
    initialTab: 'review',
    navigationBadge: undefined,
  })

  const beta = planDiffMergeView('beta')
  assert.equal(beta.phase, 'phase-b')
  assert.equal(beta.initialTab, 'review')
  assert.equal(beta.navigationBadge, 'beta')
  assert.deepEqual(
    beta.tabs.map((tab) => ({ key: tab.key, panes: tab.panes, badge: tab.badge })),
    [
      { key: 'review', panes: ['hunk-list', 'operation-pane'], badge: undefined },
      { key: 'diff', panes: ['hunk-list'], badge: 'beta' },
      { key: 'merged', panes: ['operation-pane'], badge: undefined },
    ],
  )

  const stable = planDiffMergeView('stable')
  assert.equal(stable.phase, 'phase-b')
  assert.equal(stable.initialTab, 'diff')
  assert.deepEqual(
    stable.tabs.map((tab) => ({ key: tab.key, panes: tab.panes })),
    [
      { key: 'diff', panes: ['hunk-list'] },
      { key: 'merged', panes: ['operation-pane'] },
      { key: 'review', panes: ['hunk-list', 'operation-pane'] },
    ],
  )
})

test('diffMerge sub tab plan mirrors tab ordering and navigation badge', () => {
  const beta = planDiffMergeSubTabs('beta')
  assert.deepEqual(beta, {
    tabs: ['review', 'diff', 'merged'],
    initialTab: 'review',
    navigationBadge: 'beta',
  })

  const legacy = planDiffMergeSubTabs('legacy')
  assert.deepEqual(legacy, { tabs: ['review'], initialTab: 'review', navigationBadge: undefined })
})

test('resolveDiffMergeStoredTab prefers stored tab and gracefully handles storage errors', () => {
  const plan = planDiffMergeView('stable')
  const storage: DiffMergeTabStorage & {
    getItemCalls: string[]
    setItemCalls: Array<{ key: string; value: DiffMergeSubTabKey }>
    removeItemCalls: string[]
  } = {
    getItemCalls: [],
    setItemCalls: [],
    removeItemCalls: [],
    getItem(key) {
      this.getItemCalls.push(key)
      return 'merged'
    },
    setItem(key, value): void {
      this.setItemCalls.push({ key, value: value as DiffMergeSubTabKey })
    },
    removeItem(key): void {
      this.removeItemCalls.push(key)
    },
  }

  const resolved = resolveDiffMergeStoredTab({ plan, precision: 'stable', storage })
  assert.equal(resolved, 'merged')
  assert.deepEqual(storage.setItemCalls, [])
  assert.deepEqual(storage.removeItemCalls, [])

  const fallbackStorage: DiffMergeTabStorage & {
    entries: Map<string, string>
    removed: boolean
  } = {
    entries: new Map<string, string>([[`${DIFF_MERGE_TAB_STORAGE_PREFIX}stable`, 'invalid']]),
    removed: false,
    getItem(key: string) {
      return this.entries.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      this.entries.set(key, value)
    },
    removeItem(key: string): void {
      this.removed = key === `${DIFF_MERGE_TAB_STORAGE_PREFIX}stable`
      this.entries.delete(key)
    },
  }

  const fallback = resolveDiffMergeStoredTab({
    plan,
    precision: 'stable',
    storage: fallbackStorage,
    fallback: 'review',
  })
  assert.equal(fallback, 'review')
  assert.equal(fallbackStorage.removed, true)
  assert.equal(
    fallbackStorage.entries.get(`${DIFF_MERGE_TAB_STORAGE_PREFIX}stable`),
    'review',
  )

  const errorStorage: DiffMergeTabStorage = {
    getItem() {
      throw new Error('storage unavailable')
    },
    setItem(): void {
      throw new Error('should not write after failure')
    },
  }
  const originalWarn = console.warn
  console.warn = () => {}
  try {
    const result = resolveDiffMergeStoredTab({ plan, precision: 'stable', storage: errorStorage })
    assert.equal(result, plan.initialTab)
  } finally {
    console.warn = originalWarn
  }
})

test('resolveDiffMergeStoredTab falls back to initial tab when cleanup fails', () => {
  const plan = planDiffMergeView('beta')
  let removeAttempts = 0
  const storage: DiffMergeTabStorage = {
    getItem() {
      return 'legacy-only'
    },
    setItem(): void {
      throw new Error('should not persist when removal fails')
    },
    removeItem(): void {
      removeAttempts += 1
      throw new Error('cannot remove')
    },
  }
  const originalWarn = console.warn
  console.warn = () => {}
  try {
    const resolved = resolveDiffMergeStoredTab({
      plan,
      precision: 'beta',
      storage,
      fallback: 'diff',
    })
    assert.equal(resolved, plan.initialTab)
    assert.equal(removeAttempts, 1)
  } finally {
    console.warn = originalWarn
  }
})

test('createDiffMergeNavigationKeyHandler cycles between tabs and ignores unrelated keys', () => {
  let active: DiffMergeSubTabKey = 'review'
  const handled: DiffMergeSubTabKey[] = []
  const handler = createDiffMergeNavigationKeyHandler({
    tabs: ['review', 'diff', 'merged'],
    resolveActive: () => active,
    onSelect: (key) => {
      active = key
      handled.push(key)
    },
  })

  const rightEvent = createKeyboardEvent('ArrowRight')
  handler(rightEvent)
  assert.equal(active, 'diff')
  assert.equal(rightEvent.prevented, true)

  const leftEvent = createKeyboardEvent('ArrowLeft')
  handler(leftEvent)
  assert.equal(active, 'review')
  assert.equal(leftEvent.prevented, true)

  const wrapEvent = createKeyboardEvent('ArrowLeft')
  handler(wrapEvent)
  assert.equal(active, 'merged')
  assert.equal(wrapEvent.prevented, true)

  const ignoreEvent = createKeyboardEvent('Enter')
  handler(ignoreEvent)
  assert.equal(active, 'merged')
  assert.equal(ignoreEvent.prevented, false)

  assert.deepEqual(handled, ['diff', 'review', 'merged'])
})

test('diffMergeViewDesign ties navigation plan and pane specs together', () => {
  assert.deepEqual(diffMergeViewDesign.precisionTabs.beta, planDiffMergeSubTabs('beta'))
  assert.equal(diffMergeViewDesign.tabs.length, 2)
  assert.deepEqual(
    diffMergeViewDesign.tabs.map((tab) => ({ key: tab.key, precisionRules: tab.precisionRules })),
    [
      { key: 'summary', precisionRules: ['legacy'] },
      { key: 'hunks', precisionRules: ['beta', 'stable'] },
    ],
  )
  assert.ok(diffMergeViewDesign.panes.every((pane) => pane.transitions.length > 0))
})

function createKeyboardEvent(key: string) {
  return {
    key,
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }
}
