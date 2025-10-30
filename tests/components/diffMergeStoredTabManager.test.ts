import assert from 'node:assert/strict'
import test from 'node:test'

import { planDiffMergeView, type DiffMergeTabStorage } from '../../src/components/diffMergeTypes.ts'
import { createDiffMergeStoredTabManager } from '../../src/components/diffMergeStoredTabManager.ts'

const precision = 'stable' as const; const plan = planDiffMergeView(precision)

const withConsoleWarn = async (run: () => Promise<void> | void) => {
  const originalWarn = console.warn
  const calls: unknown[][] = []
  console.warn = (...args: unknown[]) => {
    calls.push(args)
  }
  try {
    await run()
  } finally {
    console.warn = originalWarn
  }
  return calls
}

test('createDiffMergeStoredTabManager.persist stores allowed tab selections', async () => {
  const storage: DiffMergeTabStorage = {
    getItem: () => null,
    setItem: (key, value) => {
      assert.equal(key, 'diff-merge.lastTab.stable')
      assert.equal(value, 'merged')
    },
  }
  const manager = createDiffMergeStoredTabManager({ plan, precision, storage })

  assert(manager.allowedTabs.has('merged'))
  await withConsoleWarn(() => {
    manager.persist('merged')
  })
})

test('createDiffMergeStoredTabManager.persist warns in development when storage throws', async () => {
  const failure = new Error('persist-failed')
  const storage: DiffMergeTabStorage = {
    getItem: () => null,
    setItem: () => {
      throw failure
    },
  }
  const manager = createDiffMergeStoredTabManager({ plan, precision, storage })

  const calls = await withConsoleWarn(() => {
    manager.persist('merged')
  })

  assert.equal(calls.length, 1)
  const [message, error] = calls[0] ?? []
  assert.equal(message, 'DiffMergeView: failed to persist tab selection')
  assert.equal(error, failure)
})

test('createDiffMergeStoredTabManager.resolveInitialTab delegates to resolveDiffMergeStoredTab', () => {
  const storage: DiffMergeTabStorage = {
    getItem: () => 'review',
    setItem: () => {
      throw new Error('should not persist when allowed')
    },
  }
  const manager = createDiffMergeStoredTabManager({ plan, precision, storage })
  const resolved = manager.resolveInitialTab('diff')
  assert.equal(resolved, 'review')
})
