import {
  FALLBACK_LOCK_PATH,
  FALLBACK_LOCK_TTL_MS,
  LOCK_HEARTBEAT_INTERVAL_MS,
  MAX_LOCK_RETRIES,
  ProjectLockError,
  buildLease,
  createAbortError,
  emitError,
  emitReadonly,
  isAbortReason,
  makeError,
  projectLockEvents,
  type AcquireContext,
  type AcquireProjectLock,
  type AcquireProjectLockOptions,
  type BackoffPolicy,
} from './shared.js';
import { acquireViaFallback, readFallbackLeaseSnapshot } from './fallbackLock.js';
import { acquireViaWebLock } from './webLock.js';

let acquireFallback = acquireViaFallback;
let readFallbackSnapshot = readFallbackLeaseSnapshot;
let acquireWebLock = acquireViaWebLock;

export const __setAcquireAdapters = (overrides: {
  acquireViaFallback?: typeof acquireViaFallback;
  readFallbackLeaseSnapshot?: typeof readFallbackLeaseSnapshot;
  acquireViaWebLock?: typeof acquireViaWebLock;
}): void => {
  if (overrides.acquireViaFallback) acquireFallback = overrides.acquireViaFallback;
  if (overrides.readFallbackLeaseSnapshot) readFallbackSnapshot = overrides.readFallbackLeaseSnapshot;
  if (overrides.acquireViaWebLock) acquireWebLock = overrides.acquireViaWebLock;
};

export const __resetAcquireAdapters = (): void => {
  acquireFallback = acquireViaFallback;
  readFallbackSnapshot = readFallbackLeaseSnapshot;
  acquireWebLock = acquireViaWebLock;
};

const defaultBackoff: BackoffPolicy = { initialDelayMs: 500, factor: 2, maxAttempts: MAX_LOCK_RETRIES };

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

export const acquireProjectLock: AcquireProjectLock = async (options: AcquireProjectLockOptions = {}) => {
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
        const lease = strategy === 'web-lock' ? await acquireWebLock(ctx) : await acquireFallback(ctx);

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
            (await readFallbackSnapshot()) ??
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
