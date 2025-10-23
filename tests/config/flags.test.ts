import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  DEFAULT_FLAG_SNAPSHOT,
  FEATURE_FLAG_DEFINITIONS,
  FlagResolutionError,
  resolveFlags
} from '../../src/config/flags'

type StorageStub = Pick<Storage, 'getItem'>

type WorkspaceGetter = <T = unknown>(key: string) => T | undefined

function createStorage(values: Record<string, string | undefined>): StorageStub {
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(values, key)
        ? values[key] ?? null
        : null
    }
  }
}

test('workspace configuration resolves plugin enable flag before storage and defaults', () => {
  const workspace = {
    get: ((key) => {
      if (key === 'conimg.plugins.enable') {
        return '1'
      }
      return undefined
    }) as WorkspaceGetter
  }
  const storage = createStorage({
    [FEATURE_FLAG_DEFINITIONS['plugins.enable'].storageKey]: '0'
  })
  const env = {
    [FEATURE_FLAG_DEFINITIONS['plugins.enable'].envKey]: 'false'
  }

  const fromEnv = resolveFlags({ env, workspace, storage })
  assert.equal(fromEnv.plugins.enabled, false)
  assert.equal(fromEnv.plugins.source, 'env')

  const fromWorkspace = resolveFlags({ workspace, storage })
  assert.equal(fromWorkspace.plugins.enabled, true)
  assert.equal(fromWorkspace.plugins.source, 'workspace')

  const fromStorage = resolveFlags({
    storage,
    workspace: {
      get: (() => 'maybe') as WorkspaceGetter
    }
  })
  assert.equal(fromStorage.plugins.enabled, false)
  assert.equal(fromStorage.plugins.source, 'localStorage')

  const fromDefaults = resolveFlags({})
  assert.equal(
    fromDefaults.plugins.enabled,
    DEFAULT_FLAG_SNAPSHOT.plugins.enabled
  )
  assert.equal(fromDefaults.plugins.source, 'default')
})

test('resolveFlags with errors collects plugin metadata for collector snapshots', () => {
  const env = {
    [FEATURE_FLAG_DEFINITIONS['plugins.enable'].envKey]: 'truthy?'
  }
  const workspace = {
    get: ((key) => {
      if (key === 'conimg.plugins.enable') {
        return 'not-a-boolean'
      }
      return undefined
    }) as WorkspaceGetter
  }
  const storage = createStorage({
    [FEATURE_FLAG_DEFINITIONS['plugins.enable'].storageKey]: 'yes'
  })

  const resolution = resolveFlags({ env, workspace, storage }, { withErrors: true })

  assert.equal(
    resolution.snapshot.plugins.enabled,
    DEFAULT_FLAG_SNAPSHOT.plugins.enabled
  )
  assert.equal(resolution.snapshot.plugins.source, 'default')

  const pluginErrors = resolution.errors.filter(
    (error): error is FlagResolutionError => error.flag === 'plugins.enable'
  )
  assert.equal(pluginErrors.length, 3)
  assert.deepEqual(
    new Set(pluginErrors.map((error) => error.source)),
    new Set(['env', 'workspace', 'localStorage'])
  )
  for (const error of pluginErrors) {
    assert.equal(typeof error.phase, 'string')
    assert.ok(error.phase.startsWith('phase-'))
  }
})
