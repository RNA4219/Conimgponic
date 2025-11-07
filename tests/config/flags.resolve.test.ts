import { describe, it, expect } from 'node:test'
import { resolveFlags } from '../../src/config/flags.js'
import type { FlagSnapshot, FeatureFlagName } from '../../src/config/flags.js'

// Mock Environment and Storage for testing
const createMockEnv = (values: Record<string, string | undefined>) => ({
  ...process.env,
  ...Object.keys(values).reduce((acc, key) => {
    const envKey = `VITE_${key.replace(/\./g, '_').toUpperCase()}`
    return { ...acc, [envKey]: values[key] }
  }, {})
})

const createMockStorage = (items: Record<string, string | null>) => ({
  getItem: (key: string) => items[key] ?? null
})

const createMockWorkspace = (values: Record<string, unknown>) => ({
  get: (key: string) => values[key]
})

describe('resolveFlags function tests', () => {
  it('should prioritize env over localStorage and default', () => {
    const env = createMockEnv({ 'autosave.enabled': 'true' })
    const storage = createMockStorage({ 'autosave.enabled': 'false' })
    
    const snapshot = resolveFlags({ env, storage })
    
    expect(snapshot.autosave.value).toBe(true)
    expect(snapshot.autosave.source).toBe('env')
  })

  it('should fallback to localStorage when env is not set', () => {
    const storage = createMockStorage({ 'merge.precision': 'beta' })
    
    const snapshot = resolveFlags({ env: {}, storage })
    
    expect(snapshot.merge.precision).toBe('beta')
    expect(snapshot.merge.source).toBe('localStorage')
  })

  it('should use default value when both env and storage are invalid', () => {
    const storage = createMockStorage({ 'merge.precision': 'invalid' })
    
    const snapshot = resolveFlags({ env: {}, storage })
    
    expect(snapshot.merge.precision).toBe('legacy')
    expect(snapshot.merge.source).toBe('default')
    expect(snapshot.merge.errors.length).toBeGreaterThan(0)
  })

  it('should handle workspace configuration', () => {
    const workspace = createMockWorkspace({ 
      'conimg.merge.threshold': 0.8 
    })
    
    const snapshot = resolveFlags({ workspace })
    
    // workspace setting affects precision mapping
    expect(snapshot.merge.source).toBe('workspace')
  })

  it('should validate precision values', () => {
    const storage = createMockStorage({ 'merge.precision': 'invalid-value' })
    
    const snapshot = resolveFlags({ env: {}, storage })
    
    expect(snapshot.merge.errors).toContainEqual(
      expect.objectContaining({ code: 'invalid-precision' })
    )
  })

  it('should validate boolean values', () => {
    const storage = createMockStorage({ 'autosave.enabled': 'not-a-boolean' })
    
    const snapshot = resolveFlags({ env: {}, storage })
    
    expect(snapshot.autosave.errors).toContainEqual(
      expect.objectContaining({ code: 'invalid-boolean' })
    )
  })
})

describe('FlagSnapshot structure tests', () => {
  it('should return proper snapshot structure', () => {
    const snapshot = resolveFlags()
    
    expect(snapshot).toHaveProperty('autosave')
    expect(snapshot).toHaveProperty('merge')
    expect(snapshot).toHaveProperty('updatedAt')
    
    expect(snapshot.autosave).toHaveProperty('enabled')
    expect(snapshot.autosave).toHaveProperty('source')
    expect(snapshot.autosave).toHaveProperty('errors')
    
    expect(snapshot.merge).toHaveProperty('precision')
    expect(snapshot.merge).toHaveProperty('source')
    expect(snapshot.merge).toHaveProperty('errors')
  })

  it('should include validation errors in snapshot', () => {
    const storage = createMockStorage({ 'autosave.enabled': 'maybe' })
    
    const snapshot = resolveFlags({ env: {}, storage })
    
    expect(snapshot.autosave.errors.length).toBeGreaterThan(0)
    expect(snapshot.autosave.errors[0]).toMatchObject({
      code: 'invalid-boolean',
      flag: 'autosave.enabled',
      raw: 'maybe'
    })
  })
})

describe('Feature flag resolution tests', () => {
  it('should resolve individual feature flags', () => {
    const env = createMockEnv({ 'merge.precision': 'stable' })
    
    const flagValue = resolveFlags({ env }).merge.precision
    
    expect(flagValue).toBe('stable')
  })

  it('should handle mixed env and storage values', () => {
    const env = createMockEnv({ 'autosave.enabled': 'true' })
    const storage = createMockStorage({ 'merge.precision': 'beta' })
    
    const snapshot = resolveFlags({ env, storage })
    
    expect(snapshot.autosave.value).toBe(true)
    expect(snapshot.autosave.source).toBe('env')
    expect(snapshot.merge.precision).toBe('beta')
    expect(snapshot.merge.source).toBe('localStorage')
  })
})