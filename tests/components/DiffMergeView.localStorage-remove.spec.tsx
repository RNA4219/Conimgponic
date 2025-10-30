import assert from 'node:assert/strict'
import test from 'node:test'

import { planDiffMergeView, resolveDiffMergeStoredTab, type DiffMergeTabStorage } from '../../src/components/DiffMergeView.tsx'

test('DiffMergeView.localStorage-remove recovers when storage.removeItem throws by returning plan initial tab', () => {
  const precision = 'stable' as const
  const plan = planDiffMergeView(precision)
  const quotaError = Object.assign(new Error('Quota exceeded during removal'), { name: 'QuotaExceededError' })
  const warnings: unknown[][] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(args)
  }

  const storage: DiffMergeTabStorage = {
    getItem: () => 'unsupported-tab',
    setItem: () => {
      throw new Error('should not persist when removal fails')
    },
  }
  let removeAccesses = 0
  Object.defineProperty(storage, 'removeItem', {
    configurable: true,
    get() {
      removeAccesses += 1
      throw quotaError
    },
  })

  try {
    const resolved = resolveDiffMergeStoredTab({ plan, precision, storage, fallback: 'merged' })

    assert.equal(resolved, plan.initialTab)
  } finally {
    console.warn = originalWarn
  }

  assert.equal(removeAccesses, 1)
  assert.equal(warnings.length, 1)
  const [message, error] = warnings[0] ?? []
  assert.equal(
    message,
    `DiffMergeView: failed to clear stored tab selection for diff-merge.lastTab.${precision}`,
  )
  assert.equal(error, quotaError)
})
