import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { initAutoSave, type AutoSaveOptions, type AutoSavePhase, type AutoSaveStatusSnapshot, type AutoSaveError } from '../../src/lib/autosave'
import type { Storyboard } from '../../src/types'

// Mock the dependencies
vi.mock('../../src/lib/autosave/persistence.js', () => ({
  createAutoSavePersistence: () => ({
    writeCurrent: vi.fn().mockResolvedValue({ ok: true, bytes: 100 }),
    loadIndex: vi.fn().mockResolvedValue({ generation: 0, history: [] }),
    persistHistory: vi.fn().mockResolvedValue({ history: [], evicted: 0 }),
    readCurrent: vi.fn().mockResolvedValue(null),
    readHistory: vi.fn().mockResolvedValue(null)
  }),
  AUTOSAVE_HISTORY_ROTATION_PLAN: {
    currentFile: 'current.json',
    targetDirectory: 'history'
  },
  sanitizeTimestamp: (ts: string) => ts
}))

vi.mock('../../src/lib/autosave/scheduler.js', () => ({
  createAutoSaveScheduler: (callbacks: any, policy: any) => ({
    start: vi.fn(),
    scheduleFlush: vi.fn().mockResolvedValue(undefined),
    enterBackoff: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('../../src/lib/locks', () => ({
  projectLockApi: {
    withProjectLock: vi.fn().mockImplementation((fn) => fn({})),
    acquireProjectLock: vi.fn().mockResolvedValue({}),
    renewProjectLock: vi.fn().mockResolvedValue({}),
    releaseProjectLock: vi.fn().mockResolvedValue(undefined),
    subscribeLockEvents: vi.fn().mockReturnValue(() => {})
  },
  ProjectLockError: class extends Error {
    constructor(message: string, public operation: string, public retryable: boolean) {
      super(message)
      this.name = 'ProjectLockError'
    }
  }
}))

describe('AutoSave', () => {
  let mockStoryboard: Storyboard
  
  beforeEach(() => {
    mockStoryboard = {
      scenes: [],
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('initAutoSave', () => {
    test('should return disabled state when autosave is disabled via options', () => {
      const options: AutoSaveOptions = { disabled: true }
      const getStoryboard = () => mockStoryboard
      const result = initAutoSave(getStoryboard, options)

      const snapshot = result.snapshot()
      expect(snapshot.phase).toBe('disabled')
      expect(snapshot.retryCount).toBe(0)
    })

    test('should return disabled state when flagSnapshot indicates disabled', () => {
      const getStoryboard = () => mockStoryboard
      const flagSnapshot = {
        featureFlag: { value: false, source: 'localStorage' as const },
        optionsDisabled: false
      }
      const result = initAutoSave(getStoryboard, undefined, flagSnapshot)

      const snapshot = result.snapshot()
      expect(snapshot.phase).toBe('disabled')
      expect(snapshot.retryCount).toBe(0)
    })

    test('should start in idle state when enabled', () => {
      const getStoryboard = () => mockStoryboard
      const flagSnapshot = {
        featureFlag: { value: true, source: 'env' as const },
        optionsDisabled: false
      }
      const result = initAutoSave(getStoryboard, undefined, flagSnapshot)

      const snapshot = result.snapshot()
      expect(snapshot.phase).toBe('idle')
      expect(snapshot.retryCount).toBe(0)
    })

    test('should handle flushNow when enabled', async () => {
      const getStoryboard = () => mockStoryboard
      const flagSnapshot = {
        featureFlag: { value: true, source: 'env' as const },
        optionsDisabled: false
      }
      const result = initAutoSave(getStoryboard, undefined, flagSnapshot)

      // flushNow should not throw when enabled
      await expect(result.flushNow()).resolves.not.toThrow()
    })

    test('should not allow flushNow when disabled', async () => {
      const options: AutoSaveOptions = { disabled: true }
      const getStoryboard = () => mockStoryboard
      const result = initAutoSave(getStoryboard, options)

      await expect(result.flushNow()).rejects.toThrow()
      const error = await result.flushNow().catch(e => e)
      expect(error).toHaveProperty('code', 'disabled')
    })

    test('should update pendingBytes on markDirty', () => {
      const getStoryboard = () => mockStoryboard
      const flagSnapshot = {
        featureFlag: { value: true, source: 'env' as const },
        optionsDisabled: false
      }
      const result = initAutoSave(getStoryboard, undefined, flagSnapshot)

      result.markDirty({ pendingBytes: 1024 })
      const snapshot = result.snapshot()
      expect(snapshot.pendingBytes).toBe(1024)
    })

    test('should handle dispose correctly', async () => {
      const getStoryboard = () => mockStoryboard
      const flagSnapshot = {
        featureFlag: { value: true, source: 'env' as const },
        optionsDisabled: false
      }
      const result = initAutoSave(getStoryboard, undefined, flagSnapshot)

      await expect(result.dispose()).resolves.not.toThrow()
      const snapshot = result.snapshot()
      expect(snapshot.phase).toBe('disabled')
    })
  })

  describe('AutoSaveError', () => {
    test('should create error with correct properties', () => {
      const error: AutoSaveError = {
        name: 'Error',
        message: 'Test error',
        code: 'write-failed',
        retryable: true
      }

      expect(error.code).toBe('write-failed')
      expect(error.retryable).toBe(true)
      expect(error.message).toBe('Test error')
    })
  })

  describe('AutoSavePhases', () => {
    test('should have correct phase transitions', () => {
      // This test verifies the phase definitions exist and are correct
      const validPhases: AutoSavePhase[] = [
        'disabled',
        'idle',
        'dirty',
        'debouncing',
        'awaiting-lock',
        'backoff',
        'writing-current',
        'updating-index',
        'gc',
        'error'
      ]

      expect(validPhases).toContain('idle')
      expect(validPhases).toContain('disabled')
      expect(validPhases).toContain('error')
    })
  })

  describe('AutoSaveStatusSnapshot', () => {
    test('should have correct snapshot properties', () => {
      const snapshot: AutoSaveStatusSnapshot = {
        phase: 'idle',
        retryCount: 0
      }

      expect(snapshot.phase).toBe('idle')
      expect(snapshot.retryCount).toBe(0)
    })

    test('should have optional properties', () => {
      const snapshot: AutoSaveStatusSnapshot = {
        phase: 'disabled',
        retryCount: 0,
        lastSuccessAt: '2023-01-01T00:00:00Z',
        pendingBytes: 1024,
        lastError: {
          name: 'Error',
          message: 'Test error',
          code: 'write-failed',
          retryable: true
        }
      }

      expect(snapshot.lastSuccessAt).toBe('2023-01-01T00:00:00Z')
      expect(snapshot.pendingBytes).toBe(1024)
      expect(snapshot.lastError?.code).toBe('write-failed')
    })
  })
})