
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initAutoSave,
  AUTOSAVE_ERROR_TEST_MATRIX,
  AUTOSAVE_RETRY_POLICY,
  AutoSaveErrorCode,
  AutoSaveError,
  AutoSavePhase,
  AutoSaveRunnerEvent,
  AutoSaveRunnerEventType,
} from '../../../src/lib/autosave';
import { projectLockApi, ProjectLockError } from '../../../src/lib/locks';
import { createAutoSavePersistence } from '../../../src/lib/autosave/persistence';
import { createAutoSaveScheduler } from '../../../src/lib/autosave/scheduler';
import { AUTOSAVE_POLICY } from '../../../src/lib/autosave/policy';
import { resolveAutoSaveGuard } from '../../../src/lib/autosave/guard';

// Mock dependencies
vi.mock('../../../src/lib/locks');
vi.mock('../../../src/lib/autosave/persistence');
vi.mock('../../../src/lib/autosave/scheduler');
vi.mock('../../../src/lib/autosave/policy');
vi.mock('../../../src/lib/autosave/guard');

const mockGetStoryboard = () => ({
  scenes: [],
  metadata: { version: '1.0', createdAt: '2023-01-01T00:00:00Z' },
});

const createMockAutoSaveError = (
  code: AutoSaveErrorCode,
  message: string,
  retryable: boolean,
  cause?: Error,
  context?: Record<string, unknown>
): AutoSaveError => {
  const error = new Error(message) as AutoSaveError;
  error.code = code;
  error.retryable = retryable;
  if (cause) error.cause = cause;
  if (context) error.context = context;
  return error;
};

describe('AutoSave Error Recovery and Retry Strategy', () => {
  let mockPersistence: ReturnType<typeof createAutoSavePersistence>;
  let mockScheduler: ReturnType<typeof createAutoSaveScheduler>;
  let emittedEvents: AutoSaveRunnerEvent[];
  let mockClock: ReturnType<typeof vi.useFakeTimers>;

  beforeEach(() => {
    mockClock = vi.useFakeTimers();
    emittedEvents = [];

    // Reset mocks
    vi.resetAllMocks();

    // Mock projectLockApi
    (projectLockApi.withProjectLock as vi.Mock).mockImplementation(async (fn) => {
      return fn({
        leaseId: 'mock-lease-id',
        ownerId: 'mock-owner-id',
        strategy: 'web-lock',
        viaFallback: false,
        resource: 'mock-resource',
        ttlMillis: 30000,
        acquiredAt: new Date(),
        expiresAt: new Date(Date.now() + 30000),
        nextHeartbeatAt: new Date(Date.now() + 25000),
        renewAttempt: 0,
      });
    });

    // Mock persistence
    mockPersistence = {
      loadIndex: vi.fn().mockResolvedValue({ history: [], current: null, generation: 0 }),
      writeCurrent: vi.fn().mockResolvedValue({ bytes: 100 }),
      persistHistory: vi.fn().mockResolvedValue({ history: [], evicted: 0 }),
      readCurrent: vi.fn().mockResolvedValue(JSON.stringify(mockGetStoryboard())),
      readHistory: vi.fn().mockResolvedValue(JSON.stringify(mockGetStoryboard())),
    };
    (createAutoSavePersistence as vi.Mock).mockReturnValue(mockPersistence);

    // Mock scheduler
    mockScheduler = {
      start: vi.fn(),
      scheduleFlush: vi.fn(),
      dispose: vi.fn(),
      enterBackoff: vi.fn(),
    };
    (createAutoSaveScheduler as vi.Mock).mockReturnValue(mockScheduler);

    // Mock policy
    (AUTOSAVE_POLICY as any) = {
      debounceMs: 500,
      idleMs: 2000,
      maxGenerations: 20,
      maxBytes: 50 * 1024 * 1024,
      disabled: false,
    };

    // Mock guard
    (resolveAutoSaveGuard as vi.Mock).mockReturnValue({
      guard: {
        featureFlag: { value: true, source: 'default' },
        optionsDisabled: false,
      },
    });

    // Mock globalThis.__AUTOSAVE_RUNNER_HOST__ for telemetry
    Object.defineProperty(globalThis, '__AUTOSAVE_RUNNER_HOST__', {
      value: {
        emit: (event: AutoSaveRunnerEvent) => emittedEvents.push(event),
        telemetry: vi.fn(),
      },
      writable: true,
    });
  });

  afterEach(() => {
    mockClock.restore();
  });

  AUTOSAVE_ERROR_TEST_MATRIX.forEach((scenario) => {
    it(`should handle ${scenario.code} error with action ${scenario.expectedAction}`, async () => {
      const autoSave = initAutoSave(mockGetStoryboard);
      autoSave.onEvent((event) => emittedEvents.push(event));

      // Simulate error based on scenario code
      if (scenario.code === 'lock-unavailable') {
        (projectLockApi.withProjectLock as vi.Mock).mockImplementationOnce(async () => {
          throw new ProjectLockError('acquire-denied', 'Lock denied', true, 'acquire');
        });
      } else if (scenario.code === 'write-failed') {
        (projectLockApi.withProjectLock as vi.Mock).mockImplementationOnce(async (fn) => {
          await fn({
            leaseId: 'mock-lease-id',
            ownerId: 'mock-owner-id',
            strategy: 'web-lock',
            viaFallback: false,
            resource: 'mock-resource',
            ttlMillis: 30000,
            acquiredAt: new Date(),
            expiresAt: new Date(Date.now() + 30000),
            nextHeartbeatAt: new Date(Date.now() + 25000),
            renewAttempt: 0,
          });
          throw createMockAutoSaveError('write-failed', 'Write failed', true);
        });
      } else if (scenario.code === 'data-corrupted') {
        // This error is typically thrown by restore functions, not initAutoSave's flush
        // For testing purposes, we'll simulate it during writeCurrent for now
        (projectLockApi.withProjectLock as vi.Mock).mockImplementationOnce(async (fn) => {
          await fn({
            leaseId: 'mock-lease-id',
            ownerId: 'mock-owner-id',
            strategy: 'web-lock',
            viaFallback: false,
            resource: 'mock-resource',
            ttlMillis: 30000,
            acquiredAt: new Date(),
            expiresAt: new Date(Date.now() + 30000),
            nextHeartbeatAt: new Date(Date.now() + 25000),
            renewAttempt: 0,
          });
          throw createMockAutoSaveError('data-corrupted', 'Data corrupted', false);
        });
      } else if (scenario.code === 'history-overflow') {
        (projectLockApi.withProjectLock as vi.Mock).mockImplementationOnce(async (fn) => {
          await fn({
            leaseId: 'mock-lease-id',
            ownerId: 'mock-owner-id',
            strategy: 'web-lock',
            viaFallback: false,
            resource: 'mock-resource',
            ttlMillis: 30000,
            acquiredAt: new Date(),
            expiresAt: new Date(Date.now() + 30000),
            nextHeartbeatAt: new Date(Date.now() + 25000),
            renewAttempt: 0,
          });
          throw createMockAutoSaveError('history-overflow', 'History overflow', false);
        });
      } else if (scenario.code === 'disabled') {
        (createAutoSaveGuard as vi.Mock).mockReturnValue({
          guard: {
            featureFlag: { value: false, source: 'default' },
            optionsDisabled: false,
          },
        });
        const disabledAutoSave = initAutoSave(mockGetStoryboard);
        expect(disabledAutoSave.snapshot().phase).toBe('disabled');
        expect(mockScheduler.start).not.toHaveBeenCalled();
        expect(projectLockApi.withProjectLock).not.toHaveBeenCalled();
        return; // Skip further checks for disabled scenario
      }

      // Trigger a flush
      autoSave.markDirty();
      mockClock.runAllTimers(); // Advance timers for debounce/idle

      let errorCaught: AutoSaveError | undefined;
      try {
        await autoSave.flushNow();
      } catch (e) {
        errorCaught = e as AutoSaveError;
      }

      const snapshot = autoSave.snapshot();

      if (scenario.expectedAction === 'backoff') {
        expect(errorCaught).toBeDefined();
        expect(errorCaught?.retryable).toBe(true);
        expect(snapshot.phase).toBe('backoff');
        expect(snapshot.retryCount).toBeGreaterThan(0);
        expect(mockScheduler.enterBackoff).toHaveBeenCalled();
        expect(emittedEvents.some(e => e.type === 'retry-scheduled')).toBe(true);
      } else if (scenario.expectedAction === 'stop') {
        expect(errorCaught).toBeDefined();
        expect(errorCaught?.retryable).toBe(false);
        expect(snapshot.phase).toBe('disabled'); // Should transition to disabled for non-retryable errors
        expect(snapshot.lastError).toBeDefined();
        expect(mockScheduler.enterBackoff).not.toHaveBeenCalled();
        expect(emittedEvents.some(e => e.type === 'retry-exhausted')).toBe(true);
      } else if (scenario.expectedAction === 'noop') {
        // Handled by the 'disabled' scenario check above
      }
    });
  });

  it('should exhaust retries and transition to disabled phase', async () => {
    const autoSave = initAutoSave(mockGetStoryboard);
    autoSave.onEvent((event) => emittedEvents.push(event));

    (projectLockApi.withProjectLock as vi.Mock).mockImplementation(async (fn) => {
      // Simulate lock-unavailable for all attempts
      throw new ProjectLockError('acquire-denied', 'Lock denied', true, 'acquire');
    });

    autoSave.markDirty();
    mockClock.runAllTimers(); // Advance timers for debounce/idle

    let finalError: AutoSaveError | undefined;
    for (let i = 0; i < AUTOSAVE_RETRY_POLICY.maxAttempts + 1; i++) {
      try {
        await autoSave.flushNow();
      } catch (e) {
        finalError = e as AutoSaveError;
        if (i < AUTOSAVE_RETRY_POLICY.maxAttempts) {
          // Simulate backoff delay
          mockClock.advanceTimersByTime(AUTOSAVE_RETRY_POLICY.maxDelayMs);
          // Manually trigger the onReady callback for the scheduler mock
          const enterBackoffCall = (mockScheduler.enterBackoff as vi.Mock).mock.calls[i];
          if (enterBackoffCall) {
            enterBackoffCall[0].onReady();
          }
        }
      }
    }

    const snapshot = autoSave.snapshot();
    expect(finalError).toBeDefined();
    expect(finalError?.code).toBe('lock-unavailable');
    expect(snapshot.phase).toBe('disabled');
    expect(snapshot.retryCount).toBe(AUTOSAVE_RETRY_POLICY.maxAttempts);
    expect(emittedEvents.filter(e => e.type === 'retry-scheduled').length).toBe(AUTOSAVE_RETRY_POLICY.maxAttempts);
    expect(emittedEvents.some(e => e.type === 'retry-exhausted')).toBe(true);
  });

  it('should handle non-retryable error immediately and transition to disabled', async () => {
    const autoSave = initAutoSave(mockGetStoryboard);
    autoSave.onEvent((event) => emittedEvents.push(event));

    (projectLockApi.withProjectLock as vi.Mock).mockImplementationOnce(async (fn) => {
      await fn({
        leaseId: 'mock-lease-id',
        ownerId: 'mock-owner-id',
        strategy: 'web-lock',
        viaFallback: false,
        resource: 'mock-resource',
        ttlMillis: 30000,
        acquiredAt: new Date(),
        expiresAt: new Date(Date.now() + 30000),
        nextHeartbeatAt: new Date(Date.now() + 25000),
        renewAttempt: 0,
      });
      throw createMockAutoSaveError('data-corrupted', 'Corrupted data', false);
    });

    autoSave.markDirty();
    mockClock.runAllTimers();

    let errorCaught: AutoSaveError | undefined;
    try {
      await autoSave.flushNow();
    } catch (e) {
      errorCaught = e as AutoSaveError;
    }

    const snapshot = autoSave.snapshot();
    expect(errorCaught).toBeDefined();
    expect(errorCaught?.code).toBe('data-corrupted');
    expect(errorCaught?.retryable).toBe(false);
    expect(snapshot.phase).toBe('disabled');
    expect(snapshot.lastError).toBe(errorCaught);
    expect(snapshot.retryCount).toBe(0);
    expect(mockScheduler.enterBackoff).not.toHaveBeenCalled();
    expect(emittedEvents.some(e => e.type === 'retry-exhausted')).toBe(true);
  });

  it('should clear pending queue and reset state on dispose', async () => {
    const autoSave = initAutoSave(mockGetStoryboard);
    autoSave.onEvent((event) => emittedEvents.push(event));

    autoSave.markDirty(); // Add a pending item
    autoSave.markDirty(); // Add another pending item
    mockClock.runAllTimers(); // Advance timers to trigger flush

    // Simulate a long-running flush that gets disposed
    (projectLockApi.withProjectLock as vi.Mock).mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 10000)); // Long delay
    });

    const flushPromise = autoSave.flushNow();
    expect(autoSave.snapshot().phase).toBe('awaiting-lock');

    await autoSave.dispose();

    await expect(flushPromise).rejects.toThrow('AutoSave is disabled'); // Flush should be cancelled

    const snapshot = autoSave.snapshot();
    expect(snapshot.phase).toBe('disabled');
    expect(snapshot.pendingBytes).toBe(0);
    expect(snapshot.queuedGeneration).toBeUndefined();
    expect(emittedEvents.some(e => e.type === 'cancelled')).toBe(true);
  });
});
