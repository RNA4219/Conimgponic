import assert from 'node:assert/strict'
import test from 'node:test'

import { persistMergeDockActiveTab } from '../../src/components/MergeDock.tsx'

test('persistMergeDockActiveTab warns and falls back when storage quota is exceeded', () => {
  const quotaError = Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' })
  const warnings: Array<{ message: string; details: unknown[] }> = []
  const logger = {
    warn: (message: string, ...details: unknown[]) => {
      warnings.push({ message, details })
    },
  }
  const storage: { setItem: (key: string, value: string) => void } = {
    setItem: () => {
      throw quotaError
    },
  }

  const result = persistMergeDockActiveTab({
    storage,
    tab: 'diff',
    logger,
    storageKey: 'merge.lastTab',
  })

  assert.equal(result, false)
  assert.equal(warnings.length, 1)
  const [warning] = warnings
  assert.equal(
    warning?.message,
    'MergeDock: failed to persist active tab. Falling back without localStorage.',
  )
  assert.equal(warning?.details[0], 'merge.lastTab')
  assert.equal(warning?.details[1], 'diff')
  assert.equal(warning?.details[2], quotaError)
})
