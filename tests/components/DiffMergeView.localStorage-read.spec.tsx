import assert from 'node:assert/strict'
import test from 'node:test'

import { planDiffMergeView, resolveDiffMergeStoredTab, type DiffMergeTabStorage } from '../../src/components/DiffMergeView.tsx'

test('DiffMergeView.localStorage-read recovers when storage.getItem throws by returning plan initial tab', () => {
  const precision = 'stable' as const
  const plan = planDiffMergeView(precision)
  const failure = new Error('storage-read-failed')
  const warnings: unknown[][] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(args)
  }
  const storage: DiffMergeTabStorage = {
    getItem: () => {
      throw failure
    },
    setItem: () => {
      throw new Error('should not persist when read fails')
    },
  }

  try {
    const resolved = resolveDiffMergeStoredTab({ plan, precision, storage, fallback: 'review' })

    assert.equal(resolved, plan.initialTab)
  } finally {
    console.warn = originalWarn
  }

  assert.equal(warnings.length, 1)
  const [message, error] = warnings[0] ?? []
  assert.equal(
    message,
    `DiffMergeView: failed to read stored tab selection for diff-merge.lastTab.${precision}`,
  )
  assert.equal(error, failure)
})
