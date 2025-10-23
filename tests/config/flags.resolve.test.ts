import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  DEFAULT_FLAG_SNAPSHOT,
  FEATURE_FLAG_DEFINITIONS,
  FlagResolutionError,
  FlagSnapshot,
  FlagSource,
  resolveFlags
} from '../../src/config/flags'

type WorkspaceRecord = Record<string, unknown>

type StorageStub = Pick<Storage, 'getItem'>

function createStorage(values: Record<string, string | undefined>): StorageStub {
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(values, key)
        ? values[key] ?? null
        : null
    }
  }
}

test('env overrides workspace and localStorage for autosave and merge precision', () => {
  const env = {
    [FEATURE_FLAG_DEFINITIONS['autosave.enabled'].envKey]: 'true',
    [FEATURE_FLAG_DEFINITIONS['merge.precision'].envKey]: 'STABLE'
  }
  const workspace: WorkspaceRecord = {
    'conimg.autosave.enabled': false,
    'conimg.merge.threshold': 0.72
  }
  const storage = createStorage({
    [FEATURE_FLAG_DEFINITIONS['autosave.enabled'].storageKey]: '0',
    [FEATURE_FLAG_DEFINITIONS['merge.precision'].storageKey]: 'legacy'
  })

  const snapshot = resolveFlags({ env, workspace, storage, clock: () => new Date('2024-05-01T01:02:03.456Z') })

  assert.equal(snapshot.autosave.enabled, true)
  assert.equal(snapshot.autosave.source, 'env')
  assert.equal(snapshot.merge.precision, 'stable')
  assert.equal(snapshot.merge.source, 'env')
  assert.equal(snapshot.updatedAt, '2024-05-01T01:02:03.456Z')
})

test('workspace settings provide values when env is absent', () => {
  const workspace: WorkspaceRecord = {
    'conimg.autosave.enabled': '1',
    'conimg.merge.threshold': 0.83
  }

  const snapshot = resolveFlags({ workspace, clock: () => new Date('2024-02-03T04:05:06.789Z') })

  assert.equal(snapshot.autosave.enabled, true)
  assert.equal(snapshot.autosave.source, 'workspace')
  assert.equal(snapshot.merge.precision, 'stable')
  assert.equal(snapshot.merge.source, 'workspace')
  assert.equal(snapshot.updatedAt, '2024-02-03T04:05:06.789Z')
})

test('localStorage is used when env and workspace are invalid', () => {
  const env = {
    [FEATURE_FLAG_DEFINITIONS['autosave.enabled'].envKey]: 'INVALID'
  }
  const workspace: WorkspaceRecord = {
    'conimg.autosave.enabled': null,
    'conimg.merge.threshold': 'NaN'
  }
  const storage = createStorage({
    [FEATURE_FLAG_DEFINITIONS['autosave.enabled'].storageKey]: 'true',
    [FEATURE_FLAG_DEFINITIONS['merge.precision'].storageKey]: 'beta'
  })

  const snapshot = resolveFlags({ env, workspace, storage })

  assert.equal(snapshot.autosave.enabled, true)
  assert.equal(snapshot.autosave.source, 'localStorage')
  assert.equal(snapshot.merge.precision, 'beta')
  assert.equal(snapshot.merge.source, 'localStorage')
})

test('defaults are used when no sources apply', () => {
  const snapshot = resolveFlags({})
  assert.deepEqual(snapshot, {
    ...DEFAULT_FLAG_SNAPSHOT,
    updatedAt: snapshot.updatedAt
  } satisfies FlagSnapshot)

  assert.equal(snapshot.autosave.source, 'default')
  assert.equal(snapshot.merge.source, 'default')
  assert.ok(Number.isFinite(Date.parse(snapshot.updatedAt)))
})

test('source typing includes workspace', () => {
  const source: FlagSource = 'workspace'
  assert.equal(source, 'workspace')
})

test('invalid values aggregate errors and fall back to defaults', () => {
  const env = {
    [FEATURE_FLAG_DEFINITIONS['autosave.enabled'].envKey]: 'MAYBE',
    [FEATURE_FLAG_DEFINITIONS['merge.precision'].envKey]: 'invalid'
  }
  const workspace: WorkspaceRecord = {
    'conimg.autosave.enabled': 'not-boolean',
    'conimg.merge.threshold': 1.5
  }
  const storage = createStorage({
    [FEATURE_FLAG_DEFINITIONS['autosave.enabled'].storageKey]: 'truthy?',
    [FEATURE_FLAG_DEFINITIONS['merge.precision'].storageKey]: 'gamma'
  })

  const result = resolveFlags({ env, workspace, storage }, { withErrors: true })

  assert.equal(result.snapshot.autosave.enabled, DEFAULT_FLAG_SNAPSHOT.autosave.enabled)
  assert.equal(result.snapshot.autosave.source, 'default')
  assert.equal(result.snapshot.merge.precision, DEFAULT_FLAG_SNAPSHOT.merge.precision)
  assert.equal(result.snapshot.merge.source, 'default')

  assert.equal(result.errors.length, 6)
  const sources = result.errors.reduce<Record<FlagSource, number>>(
    (acc, error) => {
      acc[error.source] = (acc[error.source] ?? 0) + 1
      return acc
    },
    { env: 0, workspace: 0, localStorage: 0, default: 0 }
  )
  assert.deepEqual(sources, {
    env: 2,
    workspace: 2,
    localStorage: 2,
    default: 0
  })

  for (const error of result.errors as readonly FlagResolutionError[]) {
    assert.ok(error.message.includes(error.flag))
  }
})
