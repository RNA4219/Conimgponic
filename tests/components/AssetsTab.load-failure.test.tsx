import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { AssetRef } from '../../src/types'
import { loadAssetsCatalog } from '../../src/components/AssetsTab'

describe('AssetsTab load failure notifications (RED)', () => {
  it('alerts user, logs error, and keeps current state when OPFS load fails', async () => {
    const currentItems: AssetRef[] = [
      { id: 'asset-1', kind: 'character', label: 'Existing asset' }
    ]
    const alerts: string[] = []
    const consoleErrors: unknown[][] = []
    const setItemsCalls: Array<AssetRef[] | ((prev: AssetRef[]) => AssetRef[])> = []
    const syncedCatalogs: AssetRef[][] = []
    const failure = new Error('opfs-load-error')

    const result = await loadAssetsCatalog({
      loadJSONImpl: async () => {
        throw failure
      },
      alertImpl: (message) => {
        alerts.push(message)
      },
      consoleErrorImpl: (...args) => {
        consoleErrors.push(args)
      },
      currentItems,
      setItems: (next) => {
        setItemsCalls.push(next)
      },
      syncAssetsCatalog: (next) => {
        syncedCatalogs.push(next)
      },
    })

    assert.equal(result, false)
    assert.deepEqual(alerts, ['Failed to load assets from OPFS'])
    assert.equal(consoleErrors.length, 1)
    assert.equal(consoleErrors[0][0], 'Failed to load assets from OPFS')
    assert.equal(consoleErrors[0][1], failure)
    assert.deepEqual(setItemsCalls, [])
    assert.deepEqual(syncedCatalogs, [])
  })
})
