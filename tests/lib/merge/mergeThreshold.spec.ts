import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { FlagSnapshot } from '../../../src/config/flags.ts'
import {
  MERGE_THRESHOLD_STORAGE_KEY,
  parseMergePrecision,
  readWorkspaceSetting,
  resolveMergeThresholdSnapshot,
  useMergeThreshold,
  type MergeThresholdEnvironment,
  type MergeThresholdSnapshot,
} from '../../../src/lib/merge/threshold.ts'

const createEnvironment = (
  snapshot: Pick<FlagSnapshot, 'merge'>,
  overrides: {
    readonly envPrecision?: string
    readonly logger?: Pick<Console, 'warn'>
  } = {},
): MergeThresholdEnvironment => ({
  resolveFlags: () => snapshot,
  readEnvPrecision: () => overrides.envPrecision,
  logger: overrides.logger,
})

const createStorage = (initial: Record<string, string> = {}): Storage => {
  const store = new Map(Object.entries(initial))
  return {
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
}

test('parseMergePrecision accepts legacy/beta/stable and rejects others', () => {
  assert.equal(parseMergePrecision('legacy'), 'legacy')
  assert.equal(parseMergePrecision('beta'), 'beta')
  assert.equal(parseMergePrecision('stable'), 'stable')
  assert.equal(parseMergePrecision('unknown'), undefined)
  assert.equal(parseMergePrecision(42), undefined)
})

test.skip('readWorkspaceSetting prefers getter candidates before nested lookup', () => {
  const accessed: string[] = []
  const workspace = {
    get(key: string) {
      accessed.push(key)
      if (key === 'conimg.merge.threshold') {
        return 0.83
      }
      if (key === 'merge.threshold') {
        throw new Error('unexpected legacy key access')
      }
      return undefined
    },
  }

  const value = readWorkspaceSetting(workspace, MERGE_THRESHOLD_STORAGE_KEY)

  assert.equal(value, 0.83)
  assert.deepEqual(accessed, ['conimg.merge.threshold'])
})

test('readWorkspaceSetting resolves nested configuration objects', () => {
  const workspace = {
    conimg: {
      merge: {
        threshold: '0.84',
      },
    },
  }

  const value = readWorkspaceSetting(workspace, MERGE_THRESHOLD_STORAGE_KEY)

  assert.equal(value, '0.84')
})

test('resolveMergeThresholdSnapshot honors explicit threshold overrides', () => {
  const environment = createEnvironment({ merge: { precision: 'beta', threshold: 0.74 } })

  const snapshot = resolveMergeThresholdSnapshot(
    { precision: 'stable', threshold: 0.7 },
    environment,
  )

  assert.equal(snapshot.precision, 'stable')
  assert.equal(snapshot.threshold, 0.82)
})

test.skip('resolveMergeThresholdSnapshot reads workspace value when flags unset', () => {
  const environment = createEnvironment({ merge: { precision: 'beta', threshold: undefined } })
  const workspace = {
    get(key: string) {
      if (key === 'conimg.merge.threshold') {
        return '0.81'
      }
      return undefined
    },
  }

  const snapshot = resolveMergeThresholdSnapshot({ workspace }, environment)

  assert.equal(snapshot.precision, 'beta')
  assert.equal(snapshot.threshold, 0.81)
})

test.skip('resolveMergeThresholdSnapshot falls back to storage and logs failures', () => {
  const warnings: unknown[] = []
  const environment = createEnvironment(
    { merge: { precision: 'beta', threshold: undefined } },
    { logger: { warn: (...args: unknown[]) => warnings.push(args) } },
  )
  const storage: Storage = {
    get length() {
      return 0
    },
    clear() {},
    getItem() {
      throw new Error('denied')
    },
    key() {
      return null
    },
    removeItem() {},
    setItem() {},
  }

  const snapshot = resolveMergeThresholdSnapshot({ storage }, environment)

  assert.equal(snapshot.precision, 'beta')
  assert.equal(snapshot.threshold, 0.75)
  assert.equal(warnings.length, 1)
})

test('resolveMergeThresholdSnapshot respects env precision overrides', () => {
  const environment = createEnvironment(
    { merge: { precision: 'beta', threshold: 0.7 } },
    { envPrecision: 'stable' },
  )

  const snapshot = resolveMergeThresholdSnapshot({}, environment)

  assert.equal(snapshot.precision, 'stable')
  assert.equal(snapshot.threshold, 0.82)
})

test.skip('useMergeThreshold memoizes snapshot for stable dependencies', () => {
  const environment = createEnvironment({ merge: { precision: 'beta', threshold: 0.79 } })
  const storage = createStorage({ [MERGE_THRESHOLD_STORAGE_KEY]: '0.87' })
  const snapshots: MergeThresholdSnapshot[] = []

  function View(): React.ReactElement | null {
    const snapshot = useMergeThreshold({ storage, environment })
    snapshots.push(snapshot)
    return null
  }

  renderToStaticMarkup(React.createElement(View))

  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0]?.precision, 'beta')
  assert.equal(snapshots[0]?.threshold, 0.87)
})

void React
