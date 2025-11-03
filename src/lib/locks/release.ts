import {
  MAX_LOCK_RETRIES,
  ProjectLockError,
  emitError,
  emitReadonly,
  makeError,
  projectLockEvents,
  type BackoffPolicy,
  type ProjectLockLease,
  type ReleaseProjectLock,
} from './shared.js';
import { releaseFallbackLease } from './fallbackLock.js';
import { clearWebLockHandle, getWebLockHandle } from './webLock.js';

let releaseFallback = releaseFallbackLease;
let getWebHandle = getWebLockHandle;
let clearWebHandle = clearWebLockHandle;

export const __setReleaseAdapters = (overrides: {
  releaseFallbackLease?: typeof releaseFallbackLease;
  getWebLockHandle?: typeof getWebLockHandle;
  clearWebLockHandle?: typeof clearWebLockHandle;
}): void => {
  if (overrides.releaseFallbackLease) releaseFallback = overrides.releaseFallbackLease;
  if (overrides.getWebLockHandle) getWebHandle = overrides.getWebLockHandle;
  if (overrides.clearWebLockHandle) clearWebHandle = overrides.clearWebLockHandle;
};

export const __resetReleaseAdapters = (): void => {
  releaseFallback = releaseFallbackLease;
  getWebHandle = getWebLockHandle;
  clearWebHandle = clearWebLockHandle;
};

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

export const releaseProjectLock: ReleaseProjectLock = async (lease, options = {}) => {
  if (options.signal?.aborted) {
    const aborted = makeError('release-failed', 'Release aborted by signal', 'release', true, options.signal.reason);
    emitError(aborted);
    throw aborted;
  }

  const handle = lease.strategy === 'web-lock' ? getWebHandle(lease.leaseId) : undefined;
  const existingReleaseError = handle?.getReleaseError();
  const currentState = getReleaseFailure(lease.leaseId);

  const processFailure = (error: ProjectLockError): ReleaseFailureState => {
    const attempts = (currentState?.attempts ?? 0) + 1;
    const readonlyNotified = currentState?.readonlyNotified ?? false;
    const nextDelay = attempts < releaseBackoff.maxAttempts ? computeReleaseDelay(attempts + 1) : 0;
    return rememberReleaseFailure(lease.leaseId, error, attempts, readonlyNotified, nextDelay);
  };

  const handleFailure = (error: ProjectLockError): never => {
    const state = processFailure(error);
    emitError(state.lastError);
    if (!state.readonlyNotified && !shouldDeferReadonlyForRelease(state.lastError, state.attempts)) {
      state.readonlyNotified = true;
      releaseFailures.set(lease.leaseId, state);
      emitReadonly('release-failed', state.lastError, options.onReadonly);
    }
    throw state.lastError;
  };

  if (currentState?.nextDelayMs) {
    await awaitReleaseDelay(currentState.nextDelayMs, options.signal);
  }

  if (existingReleaseError && !currentState) {
    const state = processFailure(existingReleaseError);
    emitError(state.lastError);
    if (!state.readonlyNotified) {
      emitReadonly('release-failed', state.lastError, options.onReadonly);
      rememberReleaseFailure(lease.leaseId, state.lastError, state.attempts, true, state.nextDelayMs);
    }
    throw state.lastError;
  }

  projectLockEvents.emit({ type: 'lock:release-requested', lease });

  try {
    if (lease.strategy === 'web-lock') {
      if (handle) {
        await handle.release();
        clearWebHandle(lease.leaseId);
      }
    } else {
      await releaseFallback(lease, options.force);
    }
    clearReleaseFailure(lease.leaseId);
    projectLockEvents.emit({ type: 'lock:released', leaseId: lease.leaseId });
  } catch (error) {
    const projectError =
      error instanceof ProjectLockError
        ? error
        : makeError('release-failed', 'Failed to release project lock', 'release', true, error);
    handleFailure(projectError);
  }
};

type SafeReleaseOptions = { signal?: AbortSignal; onReadonly?: (err: ProjectLockError) => void };

export const safeRelease = async (lease: ProjectLockLease, options: SafeReleaseOptions, force: boolean) => {
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
