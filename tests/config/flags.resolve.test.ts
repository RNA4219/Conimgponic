import { test, describe } from 'node:test'
import * as assert from 'node:assert'
import {
  resolveFlags,
  resolveFeatureFlag,
  DEFAULT_FLAGS,
  type FlagSnapshot,
  type FlagSource,
  type MergePrecision
} from '../../src/config/flags.js'

// モック用のStorage実装
class MockStorage implements Pick<Storage, 'getItem'> {
  private store: Map<string, string> = new Map()
  
  constructor(initial: Record<string, string> = {}) {
    Object.entries(initial).forEach(([key, value]) => {
      this.store.set(key, value)
    })
  }
  
  getItem(key: string): string | null {
    return this.store.get(key) || null
  }
  
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

// モック用のワークスペース設定
const createMockWorkspace = (config: Record<string, unknown>) => {
  return {
    get: <T = unknown>(key: string): T | undefined => {
      return config[key] as T
    }
  }
}

describe('resolveFlags', () => {
  test('should resolve flags from env with highest priority', () => {
    const mockEnv = {
      VITE_AUTOSAVE_ENABLED: 'true',
      VITE_MERGE_PRECISION: 'beta'
    }
    
    const snapshot = resolveFlags({ env: mockEnv })
    
    assert.strictEqual(snapshot.autosave.value, true)
    assert.strictEqual(snapshot.autosave.source, 'env')
    assert.strictEqual(snapshot.merge.value, 'beta')
    assert.strictEqual(snapshot.merge.source, 'env')
  })

  test('should resolve flags from workspace when env is not set', () => {
    const mockWorkspace = createMockWorkspace({
      'conimg.autosave.enabled': true,
      'conimg.merge.threshold': 0.8
    })
    
    const snapshot = resolveFlags({ workspace: mockWorkspace })
    
    assert.strictEqual(snapshot.autosave.value, true)
    assert.strictEqual(snapshot.autosave.source, 'workspace')
    assert.strictEqual(snapshot.merge.value, 'beta')
    assert.strictEqual(snapshot.merge.source, 'workspace')
  })

  test('should resolve flags from localStorage when env and workspace are not set', () => {
    const mockStorage = new MockStorage({
      'autosave.enabled': 'true',
      'merge.precision': 'stable'
    })
    
    const snapshot = resolveFlags({ storage: mockStorage })
    
    assert.strictEqual(snapshot.autosave.value, true)
    assert.strictEqual(snapshot.autosave.source, 'localStorage')
    assert.strictEqual(snapshot.merge.value, 'stable')
    assert.strictEqual(snapshot.merge.source, 'localStorage')
  })

  test('should fall back to default values when no sources provide value', () => {
    const snapshot = resolveFlags()
    
    assert.strictEqual(snapshot.autosave.value, DEFAULT_FLAGS.autosave.enabled)
    assert.strictEqual(snapshot.autosave.source, 'default')
    assert.strictEqual(snapshot.merge.value, DEFAULT_FLAGS.merge.precision)
    assert.strictEqual(snapshot.merge.source, 'default')
    assert.strictEqual(snapshot.plugins.value, DEFAULT_FLAGS.plugins.enable)
    assert.strictEqual(snapshot.plugins.source, 'default')
  })

  test('should respect priority order: env > workspace > localStorage > default', () => {
    const mockEnv = { VITE_AUTOSAVE_ENABLED: 'true' }
    const mockWorkspace = createMockWorkspace({ 'conimg.autosave.enabled': false })
    const mockStorage = new MockStorage({ 'autosave.enabled': 'false' })
    
    // envが優先される
    const snapshot = resolveFlags({ env: mockEnv, workspace: mockWorkspace, storage: mockStorage })
    
    assert.strictEqual(snapshot.autosave.value, true)
    assert.strictEqual(snapshot.autosave.source, 'env')
  })

  test('should handle invalid values and return errors', () => {
    const mockStorage = new MockStorage({
      'autosave.enabled': 'invalid',
      'merge.precision': 'invalid'
    })
    
    const result = resolveFlags({ storage: mockStorage }, { withErrors: true })
    
    assert.strictEqual(result.snapshot.autosave.value, DEFAULT_FLAGS.autosave.enabled)
    assert.strictEqual(result.snapshot.autosave.source, 'default')
    assert.strictEqual(result.snapshot.merge.value, DEFAULT_FLAGS.merge.precision)
    assert.strictEqual(result.snapshot.merge.source, 'default')
    assert.ok(result.errors.length > 0)
  })

  test('should handle threshold values for merge.precision', () => {
    const mockWorkspace = createMockWorkspace({
      'conimg.merge.threshold': 0.85
    })
    
    const snapshot = resolveFlags({ workspace: mockWorkspace })
    
    // thresholdが0.82以上ならstable、0.75以上ならbeta
    assert.strictEqual(snapshot.merge.value, 'stable')
    assert.strictEqual((snapshot.merge as any).threshold, 0.85)
  })

  test('should handle invalid threshold values', () => {
    const mockWorkspace = createMockWorkspace({
      'conimg.merge.threshold': 0.5  // 0.75未満は無効
    })
    
    const result = resolveFlags({ workspace: mockWorkspace }, { withErrors: true })
    
    // 無効なthreshold値はエラーとなり、既定値へフォールバック
    assert.strictEqual(result.snapshot.merge.value, 'legacy')
    assert.ok(result.errors.some(err => err.code === 'invalid-threshold'))
  })

  test('should use custom clock for updatedAt', () => {
    const fixedDate = new Date('2024-01-01T00:00:00.000Z')
    const snapshot = resolveFlags({ clock: () => fixedDate })
    
    assert.strictEqual(snapshot.updatedAt, '2024-01-01T00:00:00.000Z')
  })
})

describe('resolveFeatureFlag', () => {
  test('should resolve specific flag correctly', () => {
    const mockEnv = { VITE_AUTOSAVE_ENABLED: 'true' }
    const result = resolveFeatureFlag('autosave.enabled', { env: mockEnv })
    
    assert.strictEqual(result.value, true)
    assert.strictEqual(result.source, 'env')
    assert.strictEqual(result.errors.length, 0)
  })

  test('should return default value for unknown env value', () => {
    const result = resolveFeatureFlag('autosave.enabled')
    
    assert.strictEqual(result.value, DEFAULT_FLAGS.autosave.enabled)
    assert.strictEqual(result.source, 'default')
  })
})