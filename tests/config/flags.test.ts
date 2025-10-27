import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import {
  DEFAULT_FLAGS,
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

test('resolveFlags skips default storage when storage is null', () => {
  const moduleUrl = new URL('../../src/config/flags.ts', import.meta.url)
  const script = `const calls = [];
globalThis.localStorage = {
  getItem(key) {
    calls.push(key);
    return null;
  }
};
const mod = await import(${JSON.stringify(moduleUrl.href)});
mod.resolveFlags({ storage: null });
mod.resolveFlags({ storage: null }, { withErrors: true });
console.log(JSON.stringify({ callsLength: calls.length }));
`
  const result = spawnSync(
    process.execPath,
    [
      '--no-warnings',
      '--experimental-vm-modules',
      '--loader',
      'ts-node/esm',
      '--experimental-specifier-resolution=node',
      '--input-type=module'
    ],
    { encoding: 'utf-8', input: script }
  )

  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
  const outputLine = result.stdout.trim().split('\n').pop()
  assert.ok(outputLine, 'child process must emit call count JSON')
  const { callsLength } = JSON.parse(outputLine as string) as { callsLength: number }
  assert.equal(callsLength, 0)
})

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

test('resolveFlags falls back to default autosave and merge threshold when all sources unset', () => {
  const snapshot = resolveFlags({
    env: {},
    workspace: null,
    storage: null,
    clock: () => new Date('2025-01-08T00:00:00.000Z')
  })

  assert.equal(snapshot.autosave.enabled, false)
  assert.equal(snapshot.autosave.source, 'default')
  assert.equal(snapshot.merge.threshold, DEFAULT_FLAGS.merge.profile.threshold)
  assert.equal(snapshot.merge.source, 'default')
  assert.equal(snapshot.updatedAt, '2025-01-08T00:00:00.000Z')
})

test('collector fallback applies default autosave and merge threshold when no inputs', () => {
  const resolution = resolveFlags(
    { storage: null },
    { withErrors: true }
  )

  assert.equal(DEFAULT_FLAGS.autosave.enabled, false)
  assert.equal(resolution.snapshot.autosave.enabled, false)
  assert.equal(resolution.snapshot.autosave.source, 'default')
  assert.equal(resolution.snapshot.merge.precision, DEFAULT_FLAGS.merge.precision)
  assert.equal(resolution.snapshot.merge.source, 'default')
  assert.equal(DEFAULT_FLAGS.merge.profile.threshold, 0.75)
  assert.equal(resolution.errors.length, 0)
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
