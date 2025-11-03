import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { STABLE_THRESHOLD_DEFAULT } from '../../src/config/flags.ts'
import { MergeDock } from '../../src/components/MergeDock.tsx'
import { resolveMergeThresholdSnapshot } from '../../src/lib/merge/threshold.ts'

const createFlags = () => ({
  merge: {
    precision: 'stable' as const,
    threshold: Number.NaN,
    value: 'stable' as const,
    source: 'default' as const,
    errors: [] as const,
  },
})

test('MergeDock.localStorage-read falls back to defaults when storage.getItem throws', () => {
  const failure = new Error('storage-read-failed')
  const warnings: unknown[][] = []
  const originalWarn = console.warn
  const originalWindow = (globalThis as { window?: unknown }).window
  const storage = {
    getItem: () => {
      throw failure
    },
    setItem: () => {
      throw new Error('should not persist when read fails')
    },
  }

  const flags = createFlags()
  ;(globalThis as { window?: unknown }).window = { localStorage: storage } as unknown
  console.warn = (...args: unknown[]) => {
    warnings.push(args)
  }

  try {
    let snapshot:
      | ReturnType<typeof resolveMergeThresholdSnapshot>
      | undefined
    assert.doesNotThrow(() => {
      snapshot = resolveMergeThresholdSnapshot({
        storage,
        flags,
        precision: flags.merge.precision,
      })
    })
    assert.equal(snapshot?.precision, 'stable')
    assert.equal(snapshot?.threshold, STABLE_THRESHOLD_DEFAULT)

    let html: string | undefined
    assert.doesNotThrow(() => {
      html = renderToStaticMarkup(
        <MergeDock flags={flags} workspace={null} autoSaveEnabled={true} />,
      )
    })
    assert(html)
    assert.match(html!, /class="tab active"[^>]*>Diff/)

    const thresholdWarnings = warnings.filter((entry) =>
      entry[0] === 'MergeDock: failed to read merge threshold from localStorage.'
    )
    assert(thresholdWarnings.length >= 1)
    for (const warning of thresholdWarnings) {
      assert.equal(warning[1], 'conimg.merge.threshold')
      assert.equal(warning[2], failure)
    }

    const tabWarnings = warnings.filter((entry) =>
      entry[0] === 'MergeDock: failed to read stored active tab. Falling back without localStorage.'
    )
    assert.equal(tabWarnings.length, 1)
    assert.equal(tabWarnings[0]?.[1], 'merge.lastTab')
    assert.equal(tabWarnings[0]?.[2], failure)
  } finally {
    console.warn = originalWarn
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window
    } else {
      ;(globalThis as { window?: unknown }).window = originalWindow
    }
  }
})
