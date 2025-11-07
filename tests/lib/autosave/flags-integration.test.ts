import assert from 'node:assert/strict'
import test from 'node:test'
import { initAutoSave } from '../../../src/lib/autosave'
import { DEFAULT_FLAGS } from '../../../src/config/flags'
import type { FlagSnapshot } from '../../../src/config/flags'

test('initAutoSave works with FlagSnapshot input', () => {
  const mockStoryboard = { id: 'test', title: 'Test', scenes: [], selection: [], version: 1 }
  const getStoryboard = () => mockStoryboard

  // FlagSnapshotからAutoSaveを初期化するテスト
  const flagSnapshot: FlagSnapshot = {
    autosave: {
      value: true,
      enabled: true,
      source: 'env' as const,
      errors: []
    },
    plugins: {
      value: false,
      enabled: false,
      source: 'default' as const,
      errors: []
    },
    merge: {
      value: 'beta' as const,
      precision: 'beta' as const,
      source: 'workspace' as const,
      errors: [],
      threshold: 0.8
    },
    updatedAt: '2024-01-01T00:00:00.000Z'
  }

  // AutoSaveが有効な場合のテスト
  const runner1 = initAutoSave(getStoryboard, { disabled: false }, flagSnapshot)
  const snapshot1 = runner1.snapshot()
  
  // autosaveが有効なときはdisabledでないはず
  if (flagSnapshot.autosave.enabled) {
    assert.notEqual(snapshot1.phase, 'disabled')
  } else {
    assert.equal(snapshot1.phase, 'disabled')
  }
  
  runner1.dispose()
})

test('initAutoSave handles disabled FlagSnapshot correctly', () => {
  const mockStoryboard = { id: 'test', title: 'Test', scenes: [], selection: [], version: 1 }
  const getStoryboard = () => mockStoryboard

  // AutoSaveが無効なFlagSnapshot
  const disabledFlagSnapshot: FlagSnapshot = {
    autosave: {
      value: false,
      enabled: false,
      source: 'default' as const,
      errors: []
    },
    plugins: {
      value: false,
      enabled: false,
      source: 'default' as const,
      errors: []
    },
    merge: {
      value: 'legacy' as const,
      precision: 'legacy' as const,
      source: 'default' as const,
      errors: [],
      threshold: DEFAULT_FLAGS.merge.profile.threshold
    },
    updatedAt: '2024-01-01T00:00:00.000Z'
  }

  const runner = initAutoSave(getStoryboard, undefined, disabledFlagSnapshot)
  const snapshot = runner.snapshot()
  
  // AutoSaveが無効な場合はphaseがdisabledになるべき
  assert.equal(snapshot.phase, 'disabled')
  assert.equal(snapshot.retryCount, 0)
  
  runner.dispose()
})

test('initAutoSave handles options disabled override', () => {
  const mockStoryboard = { id: 'test', title: 'Test', scenes: [], selection: [], version: 1 }
  const getStoryboard = () => mockStoryboard

  // AutoSaveが有効なFlagSnapshot
  const enabledFlagSnapshot: FlagSnapshot = {
    autosave: {
      value: true,
      enabled: true,
      source: 'env' as const,
      errors: []
    },
    plugins: {
      value: false,
      enabled: false,
      source: 'default' as const,
      errors: []
    },
    merge: {
      value: 'beta' as const,
      precision: 'beta' as const,
      source: 'workspace' as const,
      errors: [],
      threshold: 0.8
    },
    updatedAt: '2024-01-01T00:00:00.000Z'
  }

  // options.disabled = trueの場合は無効になるべき
  const runner = initAutoSave(getStoryboard, { disabled: true }, enabledFlagSnapshot)
  const snapshot = runner.snapshot()
  
  assert.equal(snapshot.phase, 'disabled')
  assert.equal(snapshot.retryCount, 0)
  
  runner.dispose()
})