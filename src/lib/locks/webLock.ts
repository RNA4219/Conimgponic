import {
  WEB_LOCK_KEY,
  WEB_LOCK_TTL_MS,
  ProjectLockLease,
  AcquireContext,
  makeError,
  buildLease,
  ProjectLockError,
} from './shared.js';

export interface WebLockHandleEntry {
  readonly release: () => Promise<void>;
  readonly getReleaseError: () => ProjectLockError | undefined;
}

const webLockHandles = new Map<string, WebLockHandleEntry>();

const createDeferred = () => {
  let settled = false;
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => {
      if (settled) return;
      settled = true;
      res();
    };
    reject = (reason) => {
      if (settled) return;
      settled = true;
      rej(reason);
    };
  });
  return {
    promise,
    resolve,
    reject,
    isSettled: () => settled,
  };
};

const awaitReleased = async (released: Promise<unknown> | undefined, setError: (error: ProjectLockError) => void) => {
  if (!released) return;
  try {
    await released;
  } catch (error) {
    setError(
      error instanceof ProjectLockError && error.operation === 'release'
        ? error
        : makeError('release-failed', 'Web Lock released promise rejected', 'release', true, error)
    );
  }
};

const toReleaseProjectError = (error: unknown): ProjectLockError =>
  error instanceof ProjectLockError && error.operation === 'release'
    ? error
    : makeError('release-failed', 'Web Lock release invocation failed', 'release', true, error);

export const acquireViaWebLock = async (ctx: AcquireContext): Promise<ProjectLockLease> => {
  const locks = (globalThis as typeof globalThis & { navigator?: Navigator }).navigator?.locks;
  if (!locks?.request) {
    throw makeError('web-lock-unsupported', 'Web Locks API unavailable', 'acquire', true);
  }

  const ready = createDeferred();
  const releaseDeferred = createDeferred();
  const completionDeferred = createDeferred();
  let releaseInvoked = false;
  let releaseError: ProjectLockError | undefined;
  let lastReleaseError: ProjectLockError | undefined;
  let releasedPromise: Promise<unknown> | undefined;

  const captureCompletionError = (error: unknown) => {
    if (releaseError) return;
    releaseError =
      error instanceof ProjectLockError
        ? error.operation === 'release'
          ? error
          : makeError('release-failed', 'Web Lock request completion rejected', 'release', error.retryable, error)
        : makeError('release-failed', 'Web Lock request completion rejected', 'release', true, error);
  };

  const setReleaseError = (error: ProjectLockError) => {
    if (!releaseError) {
      releaseError = error;
    }
  };

  const requestCallback = async (lock: unknown) => {
    if (!lock || typeof lock !== 'object') {
      throw makeError('acquire-denied', 'Web Lock handle missing', 'acquire', false);
    }

    type WebLockHandle = { released?: unknown; release?: () => Promise<void> | void };
    const handle = lock as WebLockHandle;
    const released = handle.released;
    releasedPromise =
      released && typeof (released as Promise<unknown>).then === 'function'
        ? (released as Promise<unknown>)
        : Promise.resolve();
    const releaseMethod =
      typeof handle.release === 'function' ? ((handle.release as () => Promise<void>).bind(handle) as () => Promise<void>) : undefined;

    webLockHandles.set(ctx.leaseId, {
      release: async () => {
        if (releaseInvoked && !lastReleaseError && !releaseError) return;
        releaseInvoked = true;
        const previousError = lastReleaseError ?? releaseError;
        let releaseFailure: ProjectLockError | undefined;
        releaseError = undefined;
        if (releaseMethod) {
          try {
            await releaseMethod();
          } catch (error) {
            releaseFailure = toReleaseProjectError(error);
            releaseError = releaseFailure;
          }
        }
        releaseDeferred.resolve();
        try {
          await completionDeferred.promise;
        } catch (error) {
          captureCompletionError(error);
        }
        let errorToThrow = releaseFailure ?? releaseError;
        if (!releaseFailure && releaseError && previousError && releaseError.cause === previousError.cause) {
          errorToThrow = previousError;
        }
        if (errorToThrow) {
          releaseError = errorToThrow;
          lastReleaseError = errorToThrow;
          releaseInvoked = false;
          throw errorToThrow;
        }
        releaseError = undefined;
        lastReleaseError = undefined;
      },
      getReleaseError: () => lastReleaseError ?? releaseError,
    });

    ready.resolve();
    await releaseDeferred.promise;
  };

  const invokeRequest = () =>
    ctx.signal === undefined
      ? locks.request(WEB_LOCK_KEY, requestCallback)
      : locks.request(WEB_LOCK_KEY, { mode: 'exclusive', signal: ctx.signal }, requestCallback);

  const requestOutcome: Promise<unknown> = Promise.resolve()
    .then(invokeRequest)
    .catch((error) => {
      const projectError =
        error instanceof ProjectLockError
          ? error
          : makeError('acquire-denied', 'Web Lock request rejected', 'acquire', true, error);
      if (!ready.isSettled()) {
        ready.reject(projectError);
      } else if (!releaseError) {
        releaseError = makeError(
          'release-failed',
          'Web Lock request failed during release',
          'release',
          projectError.retryable,
          projectError
        );
      }
      if (!completionDeferred.isSettled()) completionDeferred.reject(projectError);
      throw projectError;
    });

  const completion = (async () => {
    await releaseDeferred.promise;
    await awaitReleased(releasedPromise, setReleaseError);
    await requestOutcome;
  })();

  completion.then(
    () => {
      if (!completionDeferred.isSettled()) completionDeferred.resolve();
    },
    (error) => {
      captureCompletionError(error);
      if (!completionDeferred.isSettled()) completionDeferred.reject(error);
    }
  );
  requestOutcome.catch(() => undefined);

  try {
    await ready.promise;
  } catch (cause) {
    const projectError =
      cause instanceof ProjectLockError
        ? cause
        : makeError('acquire-denied', 'Web Lock request rejected', 'acquire', true, cause);
    if (!completionDeferred.isSettled()) completionDeferred.reject(projectError);
    throw projectError;
  }

  return buildLease('web-lock', WEB_LOCK_KEY, ctx.ttlMs ?? WEB_LOCK_TTL_MS, ctx.heartbeatMs, ctx);
};

export const getWebLockHandle = (leaseId: string): WebLockHandleEntry | undefined => webLockHandles.get(leaseId);

export const clearWebLockHandle = (leaseId: string): void => {
  webLockHandles.delete(leaseId);
};
