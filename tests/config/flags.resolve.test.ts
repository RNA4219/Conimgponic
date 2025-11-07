import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  resolveFlags,
  resolveFeatureFlag,
  DEFAULT_FLAGS,
  type FlagSnapshot,
  type FlagValidationError,
  BETA_THRESHOLD_DEFAULT
} from './flags.js'

// モック用のlocalStorage
class MockStorage {
  private store: Map<string, string> = new Map()
  
  getItem(key: string): string | null {
    return this.store.get(key) || null
  }
  
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  
  removeItem(key: string): void {
    this.store.delete(key)
  }
  
  clear(): void {
    this.store.clear()
  }
}

// モック用のワークスペース設定
const createMockWorkspace = (values: Record<string, unknown>) => ({
  get: (key: string) => values[key]
})

test('resolveFlags - envが最優先でフラグを解決する', () => {
  const env = { VITE_AUTOSAVE_ENABLED: 'true', VITE_MERGE_PRECISION: 'beta' }
  const result = resolveFlags({ env })
  const snapshot = result.snapshot
  
  assert.strictEqual(snapshot.autosave.value, true)
  assert.strictEqual(snapshot.autosave.source, 'env')
  assert.strictEqual(snapshot.merge.value, 'beta')
  assert.strictEqual(snapshot.merge.source, 'env')
})

test('resolveFlags - storageがenv未設定時に使用される', () => {
  const storage = new MockStorage()
  storage.setItem('autosave.enabled', 'true')
  storage.setItem('merge.precision', 'stable')
  
  const result = resolveFlags({ storage })
  const snapshot = result.snapshot
  
  assert.strictEqual(snapshot.autosave.value, true)
  assert.strictEqual(snapshot.autosave.source, 'localStorage')
  assert.strictEqual(snapshot.merge.value, 'stable')
  assert.strictEqual(snapshot.merge.source, 'localStorage')
})

test('resolveFlags - 既定値がすべて未設定時に使用される', () => {
  const result = resolveFlags()
  const snapshot = result.snapshot
  
  assert.strictEqual(snapshot.autosave.value, DEFAULT_FLAGS.autosave.enabled)
  assert.strictEqual(snapshot.autosave.source, 'default')
  assert.strictEqual(snapshot.merge.value, DEFAULT_FLAGS.merge.precision)
  assert.strictEqual(snapshot.merge.source, 'default')
  assert.strictEqual(snapshot.plugins.value, DEFAULT_FLAGS.plugins.enable)
  assert.strictEqual(snapshot.plugins.source, 'default')
})

test('resolveFlags - 不正な値がエラーとして記録される', () => {
  const storage = new MockStorage()
  storage.setItem('autosave.enabled', 'invalid')
  storage.setItem('merge.precision', 'invalid')
  
  const result = resolveFlags({ storage })
  const snapshot = result.snapshot
  const errors = result.errors
  
  // 不正な値は既定値を使用
  assert.strictEqual(snapshot.autosave.value, DEFAULT_FLAGS.autosave.enabled)
  assert.strictEqual(snapshot.merge.value, DEFAULT_FLAGS.merge.precision)
  
  // エラーが記録されている
  assert.strictEqual(errors.length, 2)
  assert.strictEqual(errors[0].code, 'invalid-boolean')
  assert.strictEqual(errors[1].code, 'invalid-precision')
  assert.strictEqual(errors[0].source, 'localStorage')
  assert.strictEqual(errors[1].source, 'localStorage')
})

test('resolveFeatureFlag - envが最優先で個別フラグを解決する', () => {
  const env = { VITE_AUTOSAVE_ENABLED: 'true' }
  const result = resolveFeatureFlag('autosave.enabled', { env })
  
  assert.strictEqual(result.value, true)
  assert.strictEqual(result.source, 'env')
  assert.strictEqual(result.errors.length, 0)
})

test('resolveFeatureFlag - storageがenv未設定時に使用される', () => {
  const storage = new MockStorage()
  storage.setItem('autosave.enabled', 'false')
  const result = resolveFeatureFlag('autosave.enabled', { storage })
  
  assert.strictEqual(result.value, false)
  assert.strictEqual(result.source, 'localStorage')
})

test('resolveFeatureFlag - 既定値が未設定時に使用される', () => {
  const result = resolveFeatureFlag('autosave.enabled')
  
  assert.strictEqual(result.value, DEFAULT_FLAGS.autosave.enabled)
  assert.strictEqual(result.source, 'default')
})

test('resolveFlags - workspace設定からも値を読み込む', () => {
  const workspace = createMockWorkspace({
    'conimg.autosave.enabled': true,
    'conimg.merge.threshold': 0.8
  })
  
  const result = resolveFlags({ workspace })
  const snapshot = result.snapshot
  
  assert.strictEqual(snapshot.autosave.value, true)
  assert.strictEqual(snapshot.autosave.source, 'workspace')
  // merge.thresholdは特別な処理が必要なため、別のテストで確認
})

test('resolveFlags - マージ閾値が0.75未満の場合はエラー', () => {
  const workspace = createMockWorkspace({
    'conimg.merge.threshold': 0.5
  })
  
  const result = resolveFlags({ workspace })
  const snapshot = result.snapshot
  const errors = result.errors
  
  // 閾値が0.75未満なのでエラーになり、既定値が使用される
  assert.strictEqual(snapshot.merge.threshold, BETA_THRESHOLD_DEFAULT)
  
  const thresholdError = errors.find(e => e.flag === 'merge.precision' && e.code === 'invalid-precision')
  assert.ok(thresholdError, '閾値が0.75未満の場合にエラーが発生する')
  assert.strictEqual(thresholdError?.source, 'workspace')
})

test('resolveFlags - マージ閾値が0.75以上は有効', () => {
  const workspace = createMockWorkspace({
    'conimg.merge.threshold': 0.8
  })
  
  const result = resolveFlags({ workspace })
  const snapshot = result.snapshot
  
  // 閾値が0.75以上なので有効
  assert.strictEqual(snapshot.merge.threshold, 0.8)
})

test('resolveFlags - 更新日時が含まれる', () => {
  const clock = () => new Date('2023-01-01T00:00:00.000Z')
  const result = resolveFlags({ clock })
  const snapshot = result.snapshot
  
  assert.strictEqual(snapshot.updatedAt, '2023-01-01T00:00:00.000Z')
})