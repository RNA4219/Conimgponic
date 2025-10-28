import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { AssetRef } from '../../src/types'
import { persistAssetsCatalog } from '../../src/components/AssetsTab'

describe('AssetsTab save failure notifications (RED)', () => {
  it('notifies user and reverts state when OPFS save fails', async () => {
    const previousItems: AssetRef[] = [
      { id: 'asset-1', kind: 'character', label: 'Hero' },
      { id: 'asset-2', kind: 'background', label: 'City' }
    ]
    const updatedItems: AssetRef[] = [
      { id: 'asset-1', kind: 'character', label: 'Hero v2' },
      { id: 'asset-3', kind: 'prop', label: 'Gadget' }
    ]
    const error = new Error('OPFS write failure')
    const saveJSONPaths: string[] = []
    let capturedItems: AssetRef[] | undefined
    let syncedCatalog: AssetRef[] | undefined
    const alertMessages: string[] = []
    const consoleCalls: unknown[][] = []

    const result = await persistAssetsCatalog({
      items: updatedItems,
      previousItems,
      saveJSONImpl: async (path, data) => {
        saveJSONPaths.push(path)
        assert.deepEqual(data, updatedItems)
        throw error
      },
      syncAssetsCatalog: (next) => {
        syncedCatalog = next
      },
      alertImpl: (message) => {
        alertMessages.push(message)
      },
      consoleErrorImpl: (...args) => {
        consoleCalls.push(args)
      },
      setItems: (next) => {
        if (typeof next === 'function') {
          const resolved = next(updatedItems)
          if (Array.isArray(resolved)) {
            capturedItems = resolved
          }
          return
        }
        capturedItems = next
      }
    })

    assert.equal(result, false)
    assert.deepEqual(saveJSONPaths, ['project/assets.json'])
    assert.deepEqual(alertMessages, ['Failed to save assets to OPFS'])
    assert.deepEqual(capturedItems, previousItems)
    assert.deepEqual(syncedCatalog, previousItems)
    assert.equal(consoleCalls.length, 1)
    assert.equal(consoleCalls[0][0], 'Failed to save assets to OPFS')
    assert.equal(consoleCalls[0][1], error)
  })
})
