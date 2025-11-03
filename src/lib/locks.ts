import { loadJSON, saveJSON } from './opfs';
import {
  FALLBACK_LOCK_PATH,
  FALLBACK_LOCK_TTL_MS,
  HEARTBEAT_LEAD_MS,
  LOCK_HEARTBEAT_INTERVAL_MS,
  MAX_LOCK_RETRIES,
  ProjectLockError,
  buildLease,
  createAbortError,
  emitError,
  emitReadonly,
  hasErrorEventBeenEmitted,
  isAbortReason,
  makeError,
  projectLockEvents,
  reasonFromOperation,
  scheduleNextHeartbeat,
} from './locks/shared.js';
import type {
  AcquireContext,
  AcquireProjectLock,
  AcquireProjectLockOptions,
  BackoffPolicy,
  ProjectLockApi,
  ProjectLockLease,
  ReleaseProjectLock,
  ReleaseProjectLockOptions,
  RenewProjectLock,
  WithProjectLock,
  WithProjectLockOptions,
} from './locks/shared.js';
import {
  acquireViaFallback,
  readFallbackLeaseSnapshot,
  releaseFallbackLease,
  type FallbackRecord,
} from './locks/fallbackLock.js';
import { acquireViaWebLock, clearWebLockHandle, getWebLockHandle } from './locks/webLock.js';

export { projectLockEvents } from './locks/shared.js';
export type {
  AcquireProjectLockOptions,
  AcquireProjectLock,
  BackoffPolicy,
  FallbackLockLeaseRecord,
  LockAcquisitionStrategy,
  ProjectLockApi,
  ProjectLockErrorCode,
  ProjectLockEvent,
  ProjectLockEventListener,
  ProjectLockEventTarget,
  ProjectLockLease,
  ProjectLockOperation,
  ProjectLockReadonlyReason,
  ProjectLockStateTransition,
  ProjectLockWarningKind,
  ReleaseProjectLock,
  ReleaseProjectLockOptions,
  RenewProjectLock,
  RenewProjectLockOptions,
  WithProjectLock,
  WithProjectLockOptions,
} from './locks/shared.js';
export {
  WEB_LOCK_KEY,
  WEB_LOCK_TTL_MS,
  FALLBACK_LOCK_PATH,
  FALLBACK_LOCK_TTL_MS,
  LOCK_HEARTBEAT_INTERVAL_MS,
  MAX_LOCK_RETRIES,
  PROJECT_LOCK_STATE_MACHINE,
  FALLBACK_LOCK_LEASE_SCHEMA,
  PROJECT_LOCK_TEST_CASES,
  ProjectLockError,
} from './locks/shared.js';

const defaultBackoff: BackoffPolicy = { initialDelayMs: 500, factor: 2, maxAttempts: MAX_LOCK_RETRIES };
const releaseBackoff: BackoffPolicy = { initialDelayMs: 500, factor: 2, maxAttempts: MAX_LOCK_RETRIES };

type ReleaseFailureState = {
  attempts: number;
  lastError: ProjectLockError;
  readonlyNotified: boolean;
  nextDelayMs: number;
};

const releaseFailures = new Map<string, ReleaseFailureState>();

const rememberReleaseFailure = (
  leaseId: string,
  error: ProjectLockError,
  attempts: number,
  readonlyNotified: boolean,
  nextDelayMs: number
): ReleaseFailureState => {
  const state: ReleaseFailureState = { attempts, lastError: error, readonlyNotified, nextDelayMs };
  releaseFailures.set(leaseId, state);
  return state;
};

const getReleaseFailure = (leaseId: string): ReleaseFailureState | undefined => releaseFailures.get(leaseId);

const clearReleaseFailure = (leaseId: string): void => {
  releaseFailures.delete(leaseId);
};

const awaitBackoff = (delayMs: number, signal?: AbortSignal): Promise<void> => {
  if (delayMs <= 0) return Promise.resolve();
  if (!signal) return new Promise((resolve) => setTimeout(resolve, delayMs));
  if (signal.aborted) {
    return Promise.reject(
      makeError('acquire-denied', 'Project lock acquisition aborted during backoff wait', 'acquire', false, signal.reason)
    );
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(
        makeError('acquire-denied', 'Project lock acquisition aborted during backoff wait', 'acquire', false, signal.reason)
      );
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
};

const awaitReleaseDelay = (delayMs: number, signal?: AbortSignal): Promise<void> => {
  if (delayMs <= 0) return Promise.resolve();
  if (!signal) return new Promise((resolve) => setTimeout(resolve, delayMs));
  if (signal.aborted)
    return Promise.reject(
      makeError('release-failed', 'Project lock release aborted during retry backoff', 'release', true, signal.reason)
    );

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(
        makeError('release-failed', 'Project lock release aborted during retry backoff', 'release', true, signal.reason)
      );
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
};

const computeReleaseDelay = (attemptNumber: number): number => {
  if (attemptNumber <= 1) return 0;
  const exponent = Math.max(0, attemptNumber - 2);
  return releaseBackoff.initialDelayMs * releaseBackoff.factor ** exponent;
};

const shouldDeferReadonlyForRelease = (error: ProjectLockError, attempts: number): boolean =>
  error.code === 'release-failed' && error.retryable && attempts < releaseBackoff.maxAttempts;

export const acquireProjectLock: AcquireProjectLock = async (options = {}) => {
  const ctx: AcquireContext = {
    leaseId: crypto.randomUUID(),
    ownerId: crypto.randomUUID(),
    ttlMs: options.ttlMs,
    heartbeatMs: options.heartbeatIntervalMs ?? LOCK_HEARTBEAT_INTERVAL_MS,
    signal: options.signal,
  };
  const backoff = { ...defaultBackoff, ...options.backoff } satisfies BackoffPolicy;
  const maxAttempts = options.retry === false ? 1 : backoff.maxAttempts;
  let allowWeb = options.preferredStrategy !== 'file-lock';
  let delay = backoff.initialDelayMs;
  let fallbackNotified = false;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const order =
      options.preferredStrategy === 'file-lock'
        ? (['file-lock'] as const)
        : (['web-lock', 'file-lock'] as const);

    for (const strategy of order) {
      if (strategy === 'web-lock' && !allowWeb) continue;
      projectLockEvents.emit({ type: 'lock:attempt', strategy, retry: attempt });

      try {
        const lease =
          strategy === 'web-lock' ? await acquireViaWebLock(ctx) : await acquireViaFallback(ctx);

        if (lease.strategy === 'file-lock' && !fallbackNotified) {
          projectLockEvents.emit({
            type: 'lock:warning',
            lease,
            warning: 'fallback-engaged',
          });
          projectLockEvents.emit({ type: 'lock:fallback-engaged', lease });
          fallbackNotified = true;
        }

        projectLockEvents.emit({ type: 'lock:acquired', lease });
        projectLockEvents.emit({
          type: 'lock:renew-scheduled',
          lease,
          nextHeartbeatInMs: Math.max(0, lease.nextHeartbeatAt - Date.now()),
        });
        return lease;
      } catch (error) {
        const baseError =
          error instanceof ProjectLockError
            ? error
            : makeError('acquire-denied', 'Project lock acquisition failed', 'acquire', true, error);
        const abortDetected =
          strategy === 'web-lock' &&
          (options.signal?.aborted === true || isAbortReason(options.signal?.reason) || isAbortReason(baseError.cause));
        const projectError = abortDetected ? createAbortError(baseError, options.signal) : baseError;

        emitError(projectError);

        if (abortDetected) {
          emitReadonly('acquire-failed', projectError, options.onReadonly);
          throw projectError;
        }

        if (projectError.code === 'fallback-conflict') {
          const lease =
            ctx.conflictLease ??
            (await readFallbackLeaseSnapshot()) ??
            buildLease('file-lock', FALLBACK_LOCK_PATH, ctx.ttlMs ?? FALLBACK_LOCK_TTL_MS, ctx.heartbeatMs, ctx);
          ctx.conflictLease = undefined;
          projectLockEvents.emit({
            type: 'lock:warning',
            lease,
            warning: 'fallback-degraded',
            detail: 'Existing fallback lock is owned by another client',
          });
        }

        if (strategy === 'web-lock' && projectError.code === 'web-lock-unsupported') {
          allowWeb = false;
          continue;
        }

        if (!projectError.retryable || attempt === maxAttempts - 1) {
          emitReadonly('acquire-failed', projectError, options.onReadonly);
          throw projectError;
        }
      }
    }

    if (attempt < maxAttempts - 1) {
      projectLockEvents.emit({ type: 'lock:waiting', retry: attempt + 1, delayMs: delay });
      await awaitBackoff(delay, ctx.signal);
      delay *= backoff.factor;
    }
  }

  const finalError = makeError('acquire-timeout', 'Exhausted project lock retries', 'acquire', false);
  emitError(finalError);
  emitReadonly('acquire-failed', finalError, options.onReadonly);
  throw finalError;
};

export const renewProjectLock: RenewProjectLock = async (lease, options = {}) => {
  if (options.signal?.aborted)
    throw makeError('renew-failed', 'Renew aborted by signal', 'renew', true, options.signal.reason);

  const now = Date.now();
  const renewalAnchor = lease.expiresAt - lease.ttlMillis;
  const storedInterval = lease.heartbeatIntervalMs;
  const inferredInterval =
    storedInterval > 0 ? storedInterval : Math.max(0, lease.nextHeartbeatAt - renewalAnchor);
  const heartbeatInterval = inferredInterval > 0 ? inferredInterval : LOCK_HEARTBEAT_INTERVAL_MS;

  if (now > lease.nextHeartbeatAt) {
    projectLockEvents.emit({ type: 'lock:warning', lease, warning: 'heartbeat-delayed' });
  }

  projectLockEvents.emit({
    type: 'lock:renew-scheduled',
    lease,
    nextHeartbeatInMs: Math.max(0, lease.nextHeartbeatAt - now),
  });

  try {
    if (lease.strategy === 'file-lock') {
      const record = (await loadJSON(FALLBACK_LOCK_PATH)) as FallbackRecord | null;
      if (!record || record.leaseId !== lease.leaseId)
        throw makeError('lease-stale', 'Fallback lease missing for renew', 'renew', false);
      await saveJSON(FALLBACK_LOCK_PATH, {
        ...record,
        expiresAt: now + lease.ttlMillis,
        ttlSeconds: lease.ttlMillis / 1000,
        mtime: now,
        heartbeatIntervalMs: heartbeatInterval,
        nextHeartbeatAt: scheduleNextHeartbeat(now + lease.ttlMillis, now, lease.ttlMillis, lease.acquiredAt),
      });
    }

    const nextExpires = Math.max(lease.expiresAt + 1, now + lease.ttlMillis);
    const refreshedNextHeartbeat = scheduleNextHeartbeat(
      nextExpires,
      now,
      lease.ttlMillis,
      lease.acquiredAt
    );
    const refreshed: ProjectLockLease = {
      ...lease,
      expiresAt: nextExpires,
      heartbeatIntervalMs: heartbeatInterval,
      nextHeartbeatAt: refreshedNextHeartbeat,
      renewAttempt: lease.renewAttempt + 1,
    };
    projectLockEvents.emit({ type: 'lock:renewed', lease: refreshed });
    projectLockEvents.emit({
      type: 'lock:renew-scheduled',
      lease: refreshed,
      nextHeartbeatInMs: Math.max(0, refreshed.nextHeartbeatAt - Date.now()),
    });
    return refreshed;
  } catch (error) {
    const projectError =
      error instanceof ProjectLockError
        ? error
        : makeError('renew-failed', 'Failed to renew project lock', 'renew', true, error);
    emitError(projectError);
    if (!projectError.retryable) emitReadonly('renew-failed', projectError);
    throw projectError;
  }
};

export const releaseProjectLock: ReleaseProjectLock = async (lease, options = {}) => {
  if (options.signal?.aborted) {
    const aborted = makeError('release-failed', 'Release aborted by signal', 'release', true, options.signal.reason);
    emitError(aborted);
    throw aborted;
  }

  const handle = lease.strategy === 'web-lock' ? getWebLockHandle(lease.leaseId) : undefined;
  const currentState = getReleaseFailure(lease.leaseId);

  const processFailure = (error: ProjectLockError): ReleaseFailureState => {
    const attempts = (currentState?.attempts ?? 0) + 1;
    const readonlyNotified = currentState?.readonlyNotified ?? false;
    const nextDelay = attempts < releaseBackoff.maxAttempts ? computeReleaseDelay(attempts + 1) : 0;
    return rememberReleaseFailure(lease.leaseId, error, attempts, readonlyNotified, nextDelay);
  };

  if (currentState?.nextDelayMs) {
    await awaitReleaseDelay(currentState.nextDelayMs, options.signal);
  }

  if (existingReleaseError && !currentState) {
    let state = processFailure(existingReleaseError);
    emitError(state.lastError);
    if (!state.readonlyNotified) {
      state = rememberReleaseFailure(lease.leaseId, state.lastError, state.attempts, true, state.nextDelayMs);
      emitReadonly('release-failed', state.lastError, options.onReadonly);
    }
    throw state.lastError;
  }

  projectLockEvents.emit({ type: 'lock:release-requested', lease });

  try {
    if (lease.strategy === 'web-lock') {
      if (handle) {
        await handle.release();
        clearWebLockHandle(lease.leaseId);
      }
    } else {
      await releaseFallbackLease(lease, options.force);
    }
    clearReleaseFailure(lease.leaseId);
    projectLockEvents.emit({ type: 'lock:released', leaseId: lease.leaseId });
  } catch (error) {
    const projectError =
      error instanceof ProjectLockError
        ? error
        : makeError('release-failed', 'Failed to release project lock', 'release', true, error);
    let state = processFailure(projectError);
    emitError(state.lastError);
    if (!state.readonlyNotified && !shouldDeferReadonlyForRelease(state.lastError, state.attempts)) {
      state = rememberReleaseFailure(lease.leaseId, state.lastError, state.attempts, true, state.nextDelayMs);
      emitReadonly('release-failed', state.lastError, options.onReadonly);
    }
    throw state.lastError;
  }
};

const safeRelease = async (lease: ProjectLockLease, options: WithProjectLockOptions, force: boolean) => {
  try {
    await releaseProjectLock(lease, { signal: options.signal, force, onReadonly: options.onReadonly });
  } catch (error) {
    if (error instanceof ProjectLockError) throw error;
    const projectError = makeError('release-failed', 'Failed to release project lock', 'release', true, error);
    const previous = getReleaseFailure(lease.leaseId);
    const attempts = (previous?.attempts ?? 0) + 1;
    const alreadyReadonly = previous?.readonlyNotified ?? false;
    const isDeferredReadonly = shouldDeferReadonlyForRelease(projectError, attempts);
    const shouldEmitReadonly = !alreadyReadonly && !isDeferredReadonly;
    const nextDelay = attempts < releaseBackoff.maxAttempts ? computeReleaseDelay(attempts + 1) : 0;
    rememberReleaseFailure(lease.leaseId, projectError, attempts, alreadyReadonly || shouldEmitReadonly, nextDelay);
    emitError(projectError);
    if (shouldEmitReadonly) emitReadonly('release-failed', projectError, options.onReadonly);
    throw projectError;
  }
};

export const withProjectLock: WithProjectLock = async (executor, options = {}) => {
  let lease = await acquireProjectLock(options);
  let activeLease = lease;
  const releaseOnError = options.releaseOnError !== false;
  let renewTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingRenew: Promise<void> | undefined;
  let stopped = false;
  let rejectRenewal: ((reason: unknown) => void) | undefined;
  const renewalFailure = new Promise<never>((_, reject) => {
    rejectRenewal = reject;
  });
  const renewalSignal = renewalFailure.catch((error) => {
    throw error;
  });

  const clearRenewTimer = () => {
    if (renewTimer) {
      clearTimeout(renewTimer);
      renewTimer = undefined;
    }
  };

  const computeRenewInterval = (current: ProjectLockLease) =>
    options.renewIntervalMs ?? Math.max(0, current.ttlMillis - HEARTBEAT_LEAD_MS);

  const scheduleRenewal = () => {
    if (stopped) return;
    clearRenewTimer();
    const interval = computeRenewInterval(activeLease);
    const nextHeartbeatInMs = Math.max(0, interval);
    if (options.renewIntervalMs !== undefined) {
      const scheduledLease: ProjectLockLease = {
        ...activeLease,
        heartbeatIntervalMs: nextHeartbeatInMs,
        nextHeartbeatAt: Date.now() + nextHeartbeatInMs,
      };
      activeLease = scheduledLease;
      lease = scheduledLease;
      projectLockEvents.emit({
        type: 'lock:renew-scheduled',
        lease: scheduledLease,
        nextHeartbeatInMs,
      });
    }
    renewTimer = setTimeout(() => {
      if (stopped) return;
      pendingRenew = renewProjectLock(activeLease, { signal: options.signal })
        .then((refreshed) => {
          activeLease = refreshed;
          lease = refreshed;
          pendingRenew = undefined;
          if (!stopped) scheduleRenewal();
        })
        .catch((error) => {
          pendingRenew = undefined;
          stopped = true;
          clearRenewTimer();
          rejectRenewal?.(error);
          throw error;
        });
    }, interval);
  };

  const stopRenewal = async () => {
    stopped = true;
    clearRenewTimer();
    if (!pendingRenew) return;
    try {
      await pendingRenew;
    } finally {
      pendingRenew = undefined;
    }
  };

  scheduleRenewal();

  const finalize = async (result: unknown) => {
    await stopRenewal();
    await safeRelease(lease, options, false);
    return result;
  };

  try {
    const outcome = await Promise.race([executor(lease), renewalSignal]);
    return (await finalize(outcome)) as Awaited<typeof outcome>;
  } catch (error) {
    let failure: unknown = error;
    let readonlyEmitted = false;
    const notifyErrorOnce = (projectError: ProjectLockError) => {
      if (!hasErrorEventBeenEmitted(projectError)) {
        emitError(projectError);
      }
    };
    if (error instanceof ProjectLockError) {
      notifyErrorOnce(error);
      if (!error.retryable) {
        emitReadonly(reasonFromOperation(error.operation), error, options.onReadonly);
        readonlyEmitted = true;
      }
    }

    if (
      failure instanceof ProjectLockError &&
      (!(error instanceof ProjectLockError) || failure !== error)
    ) {
      notifyErrorOnce(failure);
      if (!failure.retryable && !readonlyEmitted)
        emitReadonly(reasonFromOperation(failure.operation), failure, options.onReadonly);
    }

    if (!releaseOnError) throw failure;

    try {
      await stopRenewal();
    } catch (renewalError) {
      failure = renewalError;
    }

    try {
      await safeRelease(lease, options, false);
    } catch (releaseError) {
      failure = releaseError;
    }

    throw failure;
  } finally {
    stopped = true;
    clearRenewTimer();
    pendingRenew = undefined;
  }
};

export const projectLockApi: ProjectLockApi = Object.freeze({
  events: projectLockEvents,
  acquire: acquireProjectLock,
  renew: renewProjectLock,
  release: releaseProjectLock,
  withProjectLock,
});
