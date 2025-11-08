
import { describe, it, expect, vi } from 'vitest'
import {
  AUTOSAVE_ERROR_TEST_MATRIX,
  AutoSaveErrorCode,
  AutoSaveError,
  AUTOSAVE_RETRY_POLICY,
  AUTOSAVE_FAILURE_PLAN,
  AUTOSAVE_ERROR_NOTIFICATION_FLOWS,
  initAutoSave,
  AUTOSAVE_SCHEDULE_REQUESTED_EVENT,
  AUTOSAVE_RUNNER_EVENT_SPECS,
  AUTOSAVE_RUNNER_TRANSITIONS,
  AUTOSAVE_TDD_SCENARIOS,
  AUTOSAVE_FLAG_TEST_MATRIX,
  AUTOSAVE_CONTROL_RESPONSIBILITIES,
  AUTOSAVE_PHASE_DESCRIPTIONS,
  AUTOSAVE_STATE_TRANSITION_MAP,
  AUTOSAVE_QUEUE_POLICY,
  AUTOSAVE_HISTORY_ROTATION_PLAN,
  AUTOSAVE_DEFAULTS,
  AUTOSAVE_MAX_BYTES,
  AUTOSAVE_POLICY,
  resolveAutoSavePolicy,
  restorePrompt,
  restoreFromCurrent,
  restoreFrom,
  listHistory,
} from '../../src/lib/autosave'
import { ProjectLockError, projectLockApi } from '../../src/lib/locks'
import { createAutoSavePersistence } from '../../src/lib/autosave/persistence'
import { createAutoSaveScheduler } from '../../src/lib/autosave/scheduler'
import { resolveAutoSaveGuard } from '../../src/lib/autosave/guard'
import {
  publishGuardCollectorEvent,
  publishScheduleRequestedCollectorEvent,
  publishWriteCompletedCollectorEvent,
  resolveBuildSha,
} from '../../src/lib/autosave/telemetryBridge'

// Mock dependencies
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
  createAutoSaveScheduler: vi.fn(() => ({
    start: vi.fn(),
    scheduleFlush: vi.fn(),
    enterBackoff: vi.fn(),
    dispose: vi.fn(),
  })),
}))

vi.mock('../../src/lib/autosave/telemetryBridge', () => ({
  publishGuardCollectorEvent: vi.fn(),
  publishScheduleRequestedCollectorEvent: vi.fn(),
  publishWriteCompletedCollectorEvent: vi.fn(),
  resolveBuildSha: vi.fn(() => 'test-sha'),
}))

describe('AutoSave Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Helper to create a mock StoryboardProvider
  const mockStoryboardProvider = (content: any = {}) => () => content

  // Helper to create a mock AutoSaveInitGuardInput
  const mockGuardInput = (featureFlagValue: boolean = true, optionsDisabledValue: boolean = false) => ({
    flagSnapshot: {
      featureFlag: { value: featureFlagValue, source: 'default' as const },
      optionsDisabled: optionsDisabledValue,
    },
    fallbackOptionsDisabled: optionsDisabledValue,
    policyDisabled: false,
  })

  describe('createAutoSaveError', () => {
    it('should create an AutoSaveError with correct properties', () => {
      const error: AutoSaveError = (initAutoSave as any).createAutoSaveError(
        'lock-unavailable',
        'Lock failed',
        true,
        new Error('Cause error'),
        { contextKey: 'contextValue' }
      )

      expect(error.name).toBe('AutoSaveError')
      expect(error.code).toBe('lock-unavailable')
      expect(error.message).toBe('Lock failed')
      expect(error.retryable).toBe(true)
      expect(error.cause).toBeInstanceOf(Error)
      expect((error.cause as Error).message).toBe('Cause error')
      expect(error.context).toEqual({ contextKey: 'contextValue' })
    })

    it('should handle undefined cause and context', () => {
      const error: AutoSaveError = (initAutoSave as any).createAutoSaveError(
        'write-failed',
        'Write failed',
        false
      )

      expect(error.name).toBe('AutoSaveError')
      expect(error.code).toBe('write-failed')
      expect(error.message).toBe('Write failed')
      expect(error.retryable).toBe(false)
      expect(error.cause).toBeUndefined()
      expect(error.context).toBeUndefined()
    })
  })

  describe('initAutoSave error handling in runFlush', () => {
    it('should handle ProjectLockError and transition to error phase with retry-scheduled', async () => {
      const mockEmit = vi.fn()
      const mockTelemetry = vi.fn()
      const mockSchedulerEnterBackoff = vi.fn()

      vi.mocked(projectLockApi.withProjectLock).mockImplementationOnce(async () => {
        throw new ProjectLockError('Lock unavailable', 'acquire', true)
      })
      vi.mocked(createAutoSaveScheduler).mockReturnValue({
        start: vi.fn(),
        scheduleFlush: vi.fn(),
        enterBackoff: mockSchedulerEnterBackoff,
        dispose: vi.fn(),
      })

      const { flushNow, onEvent } = initAutoSave(
        mockStoryboardProvider(),
        {},
        mockGuardInput()
      )

      onEvent(mockEmit)
      ;(globalThis as any).__AUTOSAVE_RUNNER_HOST__ = { telemetry: mockTelemetry, emit: mockEmit }

      await expect(flushNow()).rejects.toThrow('Lock unavailable')

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: AUTOSAVE_SCHEDULE_REQUESTED_EVENT })
      )
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'lock-rejected', phase: 'awaiting-lock' })
      )
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'retry-scheduled', phase: 'error' })
      )
      expect(mockSchedulerEnterBackoff).toHaveBeenCalledTimes(1)
      expect(mockTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'autosave',
          phase: 'awaiting-lock',
          slo: 'p95-latency',
          detail: expect.objectContaining({
            event: 'autosave.write.failed',
            error_code: 'lock-unavailable',
            retryable: true,
          }),
        })
      )
      expect(mockTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'autosave',
          phase: 'error',
          slo: 'p95-latency',
          detail: expect.objectContaining({
            event: 'autosave.write.failed',
            error_code: 'lock-unavailable',
            retryable: true,
            reason: 'retry-scheduled',
          }),
        })
      )
    })

    it('should handle generic Error during awaiting-lock phase and transition to error phase with retry-scheduled', async () => {
      const mockEmit = vi.fn()
      const mockTelemetry = vi.fn()
      const mockSchedulerEnterBackoff = vi.fn()

      vi.mocked(projectLockApi.withProjectLock).mockImplementationOnce(async () => {
        throw new Error('Generic lock error')
      })
      vi.mocked(createAutoSaveScheduler).mockReturnValue({
        start: vi.fn(),
        scheduleFlush: vi.fn(),
        enterBackoff: mockSchedulerEnterBackoff,
        dispose: vi.fn(),
      })

      const { flushNow, onEvent } = initAutoSave(
        mockStoryboardProvider(),
        {},
        mockGuardInput()
      )

      onEvent(mockEmit)
      ;(globalThis as any).__AUTOSAVE_RUNNER_HOST__ = { telemetry: mockTelemetry, emit: mockEmit }

      await expect(flushNow()).rejects.toThrow('Generic lock error')

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: AUTOSAVE_SCHEDULE_REQUESTED_EVENT })
      )
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'lock-rejected', phase: 'awaiting-lock' })
      )
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'retry-scheduled', phase: 'error' })
      )
      expect(mockSchedulerEnterBackoff).toHaveBeenCalledTimes(1)
      expect(mockTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'autosave',
          phase: 'awaiting-lock',
          slo: 'p95-latency',
          detail: expect.objectContaining({
            event: 'autosave.write.failed',
            error_code: 'lock-unavailable',
            retryable: true,
          }),
        })
      )
      expect(mockTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'autosave',
          phase: 'error',
          slo: 'p95-latency',
          detail: expect.objectContaining({
            event: 'autosave.write.failed',
            error_code: 'lock-unavailable',
            retryable: true,
            reason: 'retry-scheduled',
          }),
        })
      )
    })

    it('should handle write-failed error and transition to error phase with retry-scheduled', async () => {
      const mockEmit = vi.fn()
      const mockTelemetry = vi.fn()
      const mockSchedulerEnterBackoff = vi.fn()

      vi.mocked(projectLockApi.withProjectLock).mockImplementationOnce(async (cb) => {
        await cb({
          leaseId: 'test-lease',
          ownerId: 'test-owner',
          strategy: 'web-lock',
          viaFallback: false,
          resource: 'test-resource',
          ttlMillis: 5000,
        })
      })
      vi.mocked(createAutoSavePersistence().writeCurrent).mockImplementationOnce(() => {
        throw new Error('Write to OPFS failed')
      })
      vi.mocked(createAutoSaveScheduler).mockReturnValue({
        start: vi.fn(),
        scheduleFlush: vi.fn(),
        enterBackoff: mockSchedulerEnterBackoff,
        dispose: vi.fn(),
      })

      const { flushNow, onEvent } = initAutoSave(
        mockStoryboardProvider(),
        {},
        mockGuardInput()
      )

      onEvent(mockEmit)
      ;(globalThis as any).__AUTOSAVE_RUNNER_HOST__ = { telemetry: mockTelemetry, emit: mockEmit }

      await expect(flushNow()).rejects.toThrow('Write to OPFS failed')

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: AUTOSAVE_SCHEDULE_REQUESTED_EVENT })
      )
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'lock-acquired', phase: 'awaiting-lock' })
      )
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'write-failed', phase: 'writing-current' })
      )
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'retry-scheduled', phase: 'error' })
      )
      expect(mockSchedulerEnterBackoff).toHaveBeenCalledTimes(1)
      expect(mockTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'autosave',
          phase: 'writing-current',
          slo: 'p95-latency',
          detail: expect.objectContaining({
            event: 'autosave.write.failed',
            error_code: 'write-failed',
            retryable: true,
          }),
        })
      )
      expect(mockTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'autosave',
          phase: 'error',
          slo: 'p95-latency',
          detail: expect.objectContaining({
            event: 'autosave.write.failed',
            error_code: 'write-failed',
            retryable: true,
            reason: 'retry-scheduled',
          }),
        })
      )
    })

    it('should transition to disabled phase if maxAttempts exceeded', async () => {
      const mockEmit = vi.fn()
      const mockTelemetry = vi.fn()
      const mockSchedulerEnterBackoff = vi.fn()

      let attemptCount = 0
      vi.mocked(projectLockApi.withProjectLock).mockImplementation(async () => {
        if (attemptCount < AUTOSAVE_RETRY_POLICY.maxAttempts) {
          attemptCount++
          throw new ProjectLockError('Lock unavailable', 'acquire', true)
        }
        throw new Error('Max attempts reached')
      })
      vi.mocked(createAutoSaveScheduler).mockReturnValue({
        start: vi.fn(),
        scheduleFlush: vi.fn(),
        enterBackoff: mockSchedulerEnterBackoff,
        dispose: vi.fn(),
      })

      const { flushNow, onEvent, snapshot } = initAutoSave(
        mockStoryboardProvider(),
        {},
        mockGuardInput()
      )

      onEvent(mockEmit)
      ;(globalThis as any).__AUTOSAVE_RUNNER_HOST__ = { telemetry: mockTelemetry, emit: mockEmit }

      for (let i = 0; i < AUTOSAVE_RETRY_POLICY.maxAttempts; i++) {
        await expect(flushNow()).rejects.toThrow('Lock unavailable')
      }
      await expect(flushNow()).rejects.toThrow('Max attempts reached')


      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'retry-exhausted', phase: 'awaiting-lock' })
      )
      expect(snapshot().phase).toBe('disabled')
      expect(mockSchedulerEnterBackoff).toHaveBeenCalledTimes(AUTOSAVE_RETRY_POLICY.maxAttempts)
      expect(mockTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'autosave',
          phase: 'awaiting-lock',
          slo: 'p95-latency',
          detail: expect.objectContaining({
            event: 'autosave.write.failed',
            error_code: 'lock-unavailable',
            retryable: true,
            reason: 'retry-exhausted',
          }),
        })
      )
    })

    it('should transition to disabled phase if error is not retryable', async () => {
      const mockEmit = vi.fn()
      const mockTelemetry = vi.fn()
      const mockSchedulerEnterBackoff = vi.fn()

      vi.mocked(projectLockApi.withProjectLock).mockImplementationOnce(async () => {
        throw (initAutoSave as any).createAutoSaveError('data-corrupted', 'Data corrupted', false)
      })
      vi.mocked(createAutoSaveScheduler).mockReturnValue({
        start: vi.fn(),
        scheduleFlush: vi.fn(),
        enterBackoff: mockSchedulerEnterBackoff,
        dispose: vi.fn(),
      })

      const { flushNow, onEvent, snapshot } = initAutoSave(
        mockStoryboardProvider(),
        {},
        mockGuardInput()
      )

      onEvent(mockEmit)
      ;(globalThis as any).__AUTOSAVE_RUNNER_HOST__ = { telemetry: mockTelemetry, emit: mockEmit }

      await expect(flushNow()).rejects.toThrow('Data corrupted')

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: AUTOSAVE_SCHEDULE_REQUESTED_EVENT })
      )
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'lock-rejected', phase: 'awaiting-lock' })
      )
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'retry-exhausted', phase: 'awaiting-lock' })
      )
      expect(snapshot().phase).toBe('disabled')
      expect(mockSchedulerEnterBackoff).not.toHaveBeenCalled()
      expect(mockTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'autosave',
          phase: 'awaiting-lock',
          slo: 'p95-latency',
          detail: expect.objectContaining({
            event: 'autosave.write.failed',
            error_code: 'data-corrupted',
            retryable: false,
            reason: 'retry-exhausted',
          }),
        })
      )
    })
  })

  describe('restoreFromCurrent', () => {
    it('should return true if current data is valid JSON', async () => {
      vi.mocked(createAutoSavePersistence().readCurrent).mockResolvedValueOnce(JSON.stringify({ some: 'data' }))
      await expect(restoreFromCurrent()).resolves.toBe(true)
    })

    it('should throw data-corrupted error if current data is invalid JSON', async () => {
      vi.mocked(createAutoSavePersistence().readCurrent).mockResolvedValueOnce('invalid json')
      await expect(restoreFromCurrent()).rejects.toThrow('Corrupted current autosave payload')
      await expect(restoreFromCurrent()).rejects.toHaveProperty('code', 'data-corrupted')
      await expect(restoreFromCurrent()).rejects.toHaveProperty('retryable', false)
    })

    it('should return false if no current data', async () => {
      vi.mocked(createAutoSavePersistence().readCurrent).mockResolvedValueOnce(null)
      await expect(restoreFromCurrent()).resolves.toBe(false)
    })
  })

  describe('restoreFrom', () => {
    it('should return true if history data is valid JSON', async () => {
      vi.mocked(createAutoSavePersistence().readHistory).mockResolvedValueOnce(JSON.stringify({ some: 'history' }))
      await expect(restoreFrom('2025-11-08T12:00:00Z')).resolves.toBe(true)
    })

    it('should throw data-corrupted error if history data is invalid JSON', async () => {
      vi.mocked(createAutoSavePersistence().readHistory).mockResolvedValueOnce('invalid history json')
      await expect(restoreFrom('2025-11-08T12:00:00Z')).rejects.toThrow('Corrupted autosave history payload')
      await expect(restoreFrom('2025-11-08T12:00:00Z')).rejects.toHaveProperty('code', 'data-corrupted')
      await expect(restoreFrom('2025-11-08T12:00:00Z')).rejects.toHaveProperty('retryable', false)
    })

    it('should throw history-overflow error if no history data for given timestamp', async () => {
      vi.mocked(createAutoSavePersistence().readHistory).mockResolvedValueOnce(null)
      await expect(restoreFrom('2025-11-08T12:00:00Z')).rejects.toThrow('Missing autosave history payload')
      await expect(restoreFrom('2025-11-08T12:00:00Z')).rejects.toHaveProperty('code', 'history-overflow')
      await expect(restoreFrom('2025-11-08T12:00:00Z')).rejects.toHaveProperty('retryable', false)
    })

    it('should throw lock-unavailable error if projectLockApi fails', async () => {
      vi.mocked(projectLockApi.withProjectLock).mockImplementationOnce(async () => {
        throw new ProjectLockError('Lock failed during restore', 'acquire', true)
      })
      await expect(restoreFrom('2025-11-08T12:00:00Z')).rejects.toThrow('Failed to acquire autosave project lock')
      await expect(restoreFrom('2025-11-08T12:00:00Z')).rejects.toHaveProperty('code', 'lock-unavailable')
      await expect(restoreFrom('2025-11-08T12:00:00Z')).rejects.toHaveProperty('retryable', true)
    })
  })
})
