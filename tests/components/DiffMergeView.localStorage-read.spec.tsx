import assert from 'node:assert/strict'
import test from 'node:test'

import { planDiffMergeView, resolveDiffMergeStoredTab, type DiffMergeTabStorage } from '../../src/components/DiffMergeView.tsx'

test('resolveDiffMergeStoredTab recovers when storage.getItem throws by returning plan initial tab', () => {
  const precision = 'stable' as const
  const plan = planDiffMergeView(precision)
  const storage: DiffMergeTabStorage = {
    getItem: () => {
      throw new Error('storage-read-failed')
    },
    setItem: () => {
      throw new Error('should not persist when read fails')
    },
  }

  const resolved = resolveDiffMergeStoredTab({ plan, precision, storage, fallback: 'review' })

  assert.equal(resolved, plan.initialTab)
})
