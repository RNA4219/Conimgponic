import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import the public API surface used in these lightweight tests
import {
  initAutoSave,
  restoreFromCurrent,
  restoreFrom,
  listHistory,
  AUTOSAVE_POLICY,
  AUTOSAVE_DEFAULTS,
  AUTOSAVE_MAX_BYTES,
  AutoSaveOptions,
} from '../../src/lib/autosave'

// Mock dependencies with minimal surface
vi.mock('../../src/lib/locks', () => ({
  projectLockApi: {
    withProjectLock: vi.fn((cb) => cb({
      leaseId: 'test-lease',
      ownerId: 'test-owner',
      strategy: 'web-lock',
      viaFallback: false,
      resource: 'test-resource',
      ttlMillis: 5000,
    })),
  },
  ProjectLockError: class ProjectLockError extends Error {
    constructor(message: string, public operation: string, public retryable: boolean) {
      super(message)
      this.name = 'ProjectLockError'
    }
  },
}))

vi.mock('../../src/lib/autosave/persistence', () => ({
  createAutoSavePersistence: vi.fn(() => ({
    loadIndex: vi.fn(() => Promise.resolve({ generation: 0, history: [], current: null })),
    writeCurrent: vi.fn(() => Promise.resolve({ bytes: 100 })),
    persistHistory: vi.fn(() => Promise.resolve({ history: [], evicted: 0 })),
    readCurrent: vi.fn(() => Promise.resolve(JSON.stringify({}))),
    readHistory: vi.fn(() => Promise.resolve(JSON.stringify({}))),
  })),
}))

vi.mock('../../src/lib/autosave/scheduler', () => ({
  createAutoSaveScheduler: vi.fn(() => ({ start: vi.fn(), scheduleFlush: vi.fn(), enterBackoff: vi.fn(), dispose: vi.fn() }))
}))

vi.mock('../../src/lib/autosave/telemetryBridge', () => ({
  publishGuardCollectorEvent: vi.fn(),
  publishScheduleRequestedCollectorEvent: vi.fn(),
  publishWriteCompletedCollectorEvent: vi.fn(),
  resolveBuildSha: vi.fn(() => 'test-sha')
}))

describe('Lightweight AutoSave tests (safety surface)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('restoreFromCurrent should return true with valid JSON (default mock)', async () => {
    const ok = await // trigger function; ensure import path works
      (async () => {
        // ensure module is loaded
        // call the function directly
        return (await import('../../src/lib/autosave')).restoreFromCurrent()
      })()
    expect(ok).toBe(true)
  })

  it('listHistory should return an empty array with default mock history', async () => {
    const { listHistory } = await import('../../src/lib/autosave')
    const res = await listHistory()
    expect(Array.isArray(res)).toBe(true)
    expect(res.length).toBe(0)
  })
})
