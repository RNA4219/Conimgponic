import { getRoot, loadJSON, saveJSON } from './opfs';

/**
 * Lock key reserved for AutoSave and future project-scoped jobs when a
 * `navigator.locks` implementation is available.
 */
export const WEB_LOCK_KEY = 'imgponic:project';

/**
 * Default TTL for the Web Lock lease. A value shorter than the fallback lock
 * ensures that a Web Lock handle is renewed slightly ahead of the file lock
 * heartbeat when both mechanisms coexist.
 */
export const WEB_LOCK_TTL_MS = 25_000;

/**
 * OPFS relative path used for the fallback lock file. This path intentionally
 * avoids the Collector / Analyzer namespaces and is colocated with the
 * AutoSave artefacts under the project root.
 */
export const FALLBACK_LOCK_PATH = 'project/.lock';

/**
 * Default TTL for the fallback lock file, expressed as milliseconds since the
 * acquisition timestamp. The value exceeds {@link WEB_LOCK_TTL_MS} to tolerate
 * worker scheduling jitter while maintaining a consistent renewal cadence.
 */
export const FALLBACK_LOCK_TTL_MS = 30_000;

/**
 * Interval for proactive heartbeat scheduling. Heartbeats are attempted before
 * either TTL expires in order to refresh both the Web Lock handle and the
 * fallback lock file atomically.
 */
export const LOCK_HEARTBEAT_INTERVAL_MS = 10_000;

/** Lead time applied when scheduling heartbeats relative to the lease expiry. */
const HEARTBEAT_LEAD_MS = 5_000;

/**
 * Maximum acquisition retries per call to {@link AcquireProjectLock}. The
 * retry window is bounded to prevent unbounded contention between concurrent
 * AutoSave instances.
 */
export const MAX_LOCK_RETRIES = 3;

export type LockAcquisitionStrategy = 'web-lock' | 'file-lock';

export interface ProjectLockLease {
  /** Stable identifier shared by the Web Lock handle and fallback file. */
  readonly leaseId: string;
  /** Identifier that ties the lease to a browser tab / worker instance. */
  readonly ownerId: string;
  /** Lock strategy currently holding the lease. */
  readonly strategy: LockAcquisitionStrategy;
  /** True when the current lease is backed by the fallback file lock. */
  readonly viaFallback: boolean;
  /** Web Lock key or fallback namespaced path, depending on the strategy. */
  readonly resource: string;
  /** Millisecond timestamp when the lease was first granted. */
  readonly acquiredAt: number;
  /** Millisecond timestamp when the lease expires without renewal. */
  readonly expiresAt: number;
  /** TTL negotiated at acquisition time. */
  readonly ttlMillis: number;
  /** Interval used to schedule subsequent heartbeats for this lease. */
  readonly heartbeatIntervalMs: number;
  /** Scheduling hint for the next renewal attempt. */
  readonly nextHeartbeatAt: number;
  /** Number of renew attempts completed for this lease. */
  readonly renewAttempt: number;
}

export type ProjectLockReadonlyReason =
  | 'acquire-failed'
  | 'renew-failed'
  | 'release-failed';

export type ProjectLockWarningKind =
  | 'fallback-engaged'
  | 'fallback-degraded'
  | 'heartbeat-delayed';

export type ProjectLockEvent =
  | {
      readonly type: 'lock:attempt';
      readonly strategy: LockAcquisitionStrategy;
      readonly retry: number;
    }
  | { readonly type: 'lock:waiting'; readonly retry: number; readonly delayMs: number }
  | { readonly type: 'lock:acquired'; readonly lease: ProjectLockLease }
  | {
      readonly type: 'lock:renew-scheduled';
      readonly lease: ProjectLockLease;
      readonly nextHeartbeatInMs: number;
    }
  | { readonly type: 'lock:renewed'; readonly lease: ProjectLockLease }
  | {
      readonly type: 'lock:warning';
      readonly lease: ProjectLockLease;
      readonly warning: ProjectLockWarningKind;
      readonly detail?: string;
    }
  | { readonly type: 'lock:fallback-engaged'; readonly lease: ProjectLockLease }
  | { readonly type: 'lock:release-requested'; readonly lease: ProjectLockLease }
  | { readonly type: 'lock:released'; readonly leaseId: string }
  | {
      readonly type: 'lock:error';
      readonly operation: ProjectLockOperation;
      readonly error: ProjectLockError;
      readonly retryable: boolean;
    }
  | {
      readonly type: 'lock:readonly-entered';
      readonly reason: ProjectLockReadonlyReason;
      readonly lastError: ProjectLockError;
      readonly retryable: false;
    };

export type ProjectLockEventListener = (event: ProjectLockEvent) => void;

export interface ProjectLockEventTarget {
  subscribe(listener: ProjectLockEventListener): () => void;
  emit(event: ProjectLockEvent): void;
}

export interface BackoffPolicy { readonly initialDelayMs: number; readonly factor: number; readonly maxAttempts: number; }

export interface AcquireProjectLockOptions {
  readonly signal?: AbortSignal;
  /**
   * Explicit TTL override shared across Web Lock and fallback lock leases.
   * Must be greater than the heartbeat interval to remain effective.
   */
  readonly ttlMs?: number;
  /** Interval used when scheduling heartbeats prior to TTL expiration. */
  readonly heartbeatIntervalMs?: number;
  /**
   * Acquire strategy preference. `web-lock` is attempted first when omitted.
   * `file-lock` only mode is reserved for environments without Web Locks.
   */
  readonly preferredStrategy?: LockAcquisitionStrategy;
  /**
   * Per-attempt backoff configuration. Missing values default to the
   * AutoSave-wide strategy constants in this module.
   */
  readonly backoff?: Partial<BackoffPolicy>;
  /** Disable automatic retries when false. Defaults to true. */
  readonly retry?: boolean;
  /** Optional callback invoked when the lock layer transitions to read-only. */
  readonly onReadonly?: (reason: ProjectLockError) => void;
}

export interface RenewProjectLockOptions { readonly signal?: AbortSignal; }

export interface ReleaseProjectLockOptions {
  readonly signal?: AbortSignal;
  readonly force?: boolean;
  readonly onReadonly?: (error: ProjectLockError) => void;
}

export interface WithProjectLockOptions extends AcquireProjectLockOptions { readonly renewIntervalMs?: number; readonly releaseOnError?: boolean; }

/** Attempts project-scoped acquisition, invoking the fallback path when Web Locks fail and emitting events per {@link PROJECT_LOCK_STATE_MACHINE}. */
export type AcquireProjectLock = (options?: AcquireProjectLockOptions) => Promise<ProjectLockLease>;

/** Renews both lock channels atomically; failures stay retryable until the active TTL lapses. */
export type RenewProjectLock = (lease: ProjectLockLease, options?: RenewProjectLockOptions) => Promise<ProjectLockLease>;

/** Releases the lease, ensuring fallback artefacts are removed even during forced teardown. */
export type ReleaseProjectLock = (lease: ProjectLockLease, options?: ReleaseProjectLockOptions) => Promise<void>;

/** Wraps {@link AcquireProjectLock}, {@link RenewProjectLock}, and {@link ReleaseProjectLock} so AutoSave either completes or downgrades to read-only via events. */
export type WithProjectLock = <T>(executor: (lease: ProjectLockLease) => Promise<T>, options?: WithProjectLockOptions) => Promise<T>;

export interface ProjectLockApi {
  readonly events: ProjectLockEventTarget;
  readonly acquire: AcquireProjectLock;
  readonly renew: RenewProjectLock;
  readonly release: ReleaseProjectLock;
  readonly withProjectLock: WithProjectLock;
}

export type ProjectLockOperation = 'acquire' | 'renew' | 'release';

export type ProjectLockErrorCode =
  | 'web-lock-unsupported'
  | 'acquire-denied'
  | 'acquire-timeout'
  | 'fallback-conflict'
  | 'lease-stale'
  | 'renew-failed'
  | 'release-failed';

export class ProjectLockError extends Error {
  readonly code: ProjectLockErrorCode;
  readonly retryable: boolean;
  readonly cause?: unknown;
  readonly operation: ProjectLockOperation;

  constructor(
    code: ProjectLockErrorCode,
    message: string,
    options: { retryable: boolean; operation: ProjectLockOperation; cause?: unknown }
  ) {
    super(message);
    this.code = code;
    this.retryable = options.retryable;
    this.cause = options.cause;
    this.operation = options.operation;
    this.name = 'ProjectLockError';
  }
}

export interface ProjectLockStateTransition {
  readonly state:
    | 'idle'
    | 'acquiring:web-lock'
    | 'acquiring:file-lock'
    | 'acquired'
    | 'renewing'
    | 'releasing'
    | 'readonly';
  readonly action:
    | 'request'
    | 'fallback'
    | 'lease-established'
    | 'heartbeat'
    | 'timeout'
    | 'force-release'
    | 'error';
  readonly next: ProjectLockStateTransition['state'];
  readonly retryable: boolean;
  readonly notes: string;
}

export const PROJECT_LOCK_STATE_MACHINE: readonly ProjectLockStateTransition[] = Object.freeze([
  { state: 'idle', action: 'request', next: 'acquiring:web-lock', retryable: true, notes: 'Primary acquisition attempts Web Locks first with ttl=25s (or ttlMs override) and max 3 retries using exponential backoff.' },
  { state: 'acquiring:web-lock', action: 'fallback', next: 'acquiring:file-lock', retryable: true, notes: 'When navigator.locks is unavailable or denied, switch to project/.lock using a shared leaseId, ttl=30s, and collision detection.' },
  { state: 'acquiring:file-lock', action: 'lease-established', next: 'acquired', retryable: true, notes: 'Successful acquisition schedules heartbeats every 10s and records expiresAt based on negotiated ttl.' },
  { state: 'acquired', action: 'heartbeat', next: 'renewing', retryable: true, notes: 'Heartbeats renew both lock mechanisms ahead of ttl expiry; delays trigger lock:warning events with retry guidance.' },
  { state: 'renewing', action: 'timeout', next: 'readonly', retryable: false, notes: 'Renewals that miss ttlSeconds demote AutoSave to read-only and require user notification per docs/AUTOSAVE-DESIGN-IMPL.md.' },
  { state: 'renewing', action: 'lease-established', next: 'acquired', retryable: true, notes: 'Renew success updates renewAttempt and schedules the next heartbeat based on heartbeatIntervalMs.' },
  { state: 'acquired', action: 'force-release', next: 'releasing', retryable: true, notes: 'Forced release bypasses Web Lock release but must unlink the fallback file to avoid stale leases.' },
  { state: 'releasing', action: 'lease-established', next: 'idle', retryable: true, notes: 'Release completion resets retry counters and clears scheduled renewals, returning to idle.' },
  { state: 'acquiring:web-lock', action: 'error', next: 'readonly', retryable: false, notes: 'Acquisition errors after maxAttempts=3 trigger read-only mode and UI banner with retry CTA.' },
  { state: 'acquiring:file-lock', action: 'error', next: 'readonly', retryable: false, notes: 'Fallback collisions detected via leaseId/mtime comparison keep the project in read-only to prevent split-brain writes.' },
]);

export interface FallbackLockLeaseRecord {
  readonly leaseId: string;
  readonly ownerId: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
  readonly ttlSeconds: number;
  readonly mtime: number;
  readonly heartbeatIntervalMs?: number;
  readonly nextHeartbeatAt?: number;
}

export const FALLBACK_LOCK_LEASE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'com.day8.conimgponic.project-lock-lease',
  type: 'object',
  additionalProperties: false,
  required: ['leaseId', 'ownerId', 'acquiredAt', 'expiresAt', 'ttlSeconds', 'mtime'],
  properties: {
    leaseId: { type: 'string', format: 'uuid' },
    ownerId: { type: 'string', minLength: 1 },
    acquiredAt: { type: 'integer', minimum: 0 },
    expiresAt: { type: 'integer', minimum: 0 },
    ttlSeconds: { type: 'number', minimum: 1 },
    mtime: { type: 'integer', minimum: 0 },
    heartbeatIntervalMs: { type: 'integer', minimum: 0 },
    nextHeartbeatAt: { type: 'integer', minimum: 0 },
  },
} as const;

export const PROJECT_LOCK_TEST_CASES = Object.freeze({
  webLock: [
    'acquire success with navigator.locks mock resolving immediately',
    'acquire timeout leading to fallback engagement and warning event',
    'renewal heartbeat before ttl expiry with sequential lease extension',
  ],
  fallback: [
    'file-lock collision detected via differing leaseId while mtime < ttl',
    'stale fallback record ignored when expiresAt < now and new lease succeeds',
    'force release removes project/.lock even when web lock handle is lost',
  ],
  readonly: [
    'max retries exceeded emits lock:readonly-entered with retryable=false',
    'renewal timeout triggers UI downgrade event and halts AutoSave writes',
  ],
});

const defaultBackoff: BackoffPolicy = { initialDelayMs: 500, factor: 2, maxAttempts: MAX_LOCK_RETRIES };
const releaseBackoff: BackoffPolicy = { initialDelayMs: 500, factor: 2, maxAttempts: MAX_LOCK_RETRIES };
const listeners = new Set<ProjectLockEventListener>();

export const projectLockEvents: ProjectLockEventTarget = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  emit(event) {
    listeners.forEach((fn) => fn(event));
  },
};

type WebLockHandleEntry = {
  readonly release: () => Promise<void>;
  readonly getReleaseError: () => ProjectLockError | undefined;
};

const webLockHandles = new Map<string, WebLockHandleEntry>();
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
) => {
  const state: ReleaseFailureState = { attempts, lastError: error, readonlyNotified, nextDelayMs };
  releaseFailures.set(leaseId, state);
  return state;
};

const getReleaseFailure = (leaseId: string): ReleaseFailureState | undefined => releaseFailures.get(leaseId);

const clearReleaseFailure = (leaseId: string) => {
  releaseFailures.delete(leaseId);
};
type AcquireContext = {
  readonly leaseId: string;
  readonly ownerId: string;
  readonly ttlMs?: number;
  readonly heartbeatMs: number;
  readonly signal?: AbortSignal;
  conflictLease?: ProjectLockLease;
};

const makeError = (
  code: ProjectLockErrorCode,
  message: string,
  operation: ProjectLockOperation,
  retryable: boolean,
  cause?: unknown
) => new ProjectLockError(code, message, { operation, retryable, cause });

const isAbortReason = (reason: unknown): boolean => {
  if (!reason) return false;
  if (reason instanceof DOMException) return reason.name === 'AbortError';
  if (reason instanceof Error) return reason.name === 'AbortError';
  return typeof reason === 'string' && reason === 'AbortError';
};

const createAbortError = (
  base: ProjectLockError,
  signal: AbortSignal | undefined
): ProjectLockError => {
  if (!base.retryable) return base;
  const cause = base.cause ?? signal?.reason ?? base;
  return makeError('acquire-denied', 'Project lock acquisition aborted', 'acquire', false, cause);
};

const emitError = (error: ProjectLockError) => {
  projectLockEvents.emit({ type: 'lock:error', operation: error.operation, error, retryable: error.retryable });
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

const emitReadonly = (
  reason: ProjectLockReadonlyReason,
  error: ProjectLockError,
  onReadonly?: (err: ProjectLockError) => void
) => {
  projectLockEvents.emit({ type: 'lock:readonly-entered', reason, lastError: error, retryable: false });
  onReadonly?.(error);
};

const reasonFromOperation = (operation: ProjectLockOperation): ProjectLockReadonlyReason =>
  operation === 'acquire' ? 'acquire-failed' : operation === 'renew' ? 'renew-failed' : 'release-failed';

const scheduleNextHeartbeat = (
  expiresAt: number,
  _referenceTime: number,
  ttl: number,
  acquiredAt: number
): number => {
  const effectiveTtl = Math.max(0, ttl);
  const lead = Math.min(HEARTBEAT_LEAD_MS, effectiveTtl);
  const scheduled = Math.min(expiresAt - lead, expiresAt);
  return Math.max(acquiredAt, scheduled);
};

const buildLease = (
  strategy: LockAcquisitionStrategy,
  resource: string,
  ttl: number,
  heartbeatMs: number,
  ctx: AcquireContext,
  acquiredAt = Date.now(),
  renewAttempt = 0
): ProjectLockLease => {
  const heartbeatInterval = heartbeatMs > 0 ? heartbeatMs : LOCK_HEARTBEAT_INTERVAL_MS;
  const now = Date.now();
  const expiresAt = now + ttl;
  const nextHeartbeatAt = scheduleNextHeartbeat(expiresAt, now, ttl, acquiredAt);
  return {
    leaseId: ctx.leaseId,
    ownerId: ctx.ownerId,
    strategy,
    viaFallback: strategy === 'file-lock',
    resource,
    acquiredAt,
    expiresAt,
    ttlMillis: ttl,
    heartbeatIntervalMs: heartbeatInterval,
    nextHeartbeatAt,
    renewAttempt,
  };
};

const fallbackRecordToLease = (record: FallbackLockLeaseRecord): ProjectLockLease => {
  const ttlMillis = Math.max(0, Math.round(record.ttlSeconds * 1000));
  const storedHeartbeat = record.heartbeatIntervalMs ?? 0;
  const effectiveHeartbeat = storedHeartbeat > 0 ? storedHeartbeat : LOCK_HEARTBEAT_INTERVAL_MS;
  const storedNextHeartbeat = record.nextHeartbeatAt ?? 0;
  const computedNextHeartbeat = scheduleNextHeartbeat(
    record.expiresAt,
    record.mtime,
    ttlMillis,
    record.acquiredAt
  );
  const nextHeartbeatAt = storedNextHeartbeat > 0 ? storedNextHeartbeat : computedNextHeartbeat;
  const renewAttempt =
    effectiveHeartbeat > 0
      ? Math.max(0, Math.floor(Math.max(0, record.mtime - record.acquiredAt) / effectiveHeartbeat))
      : 0;

  return {
    leaseId: record.leaseId,
    ownerId: record.ownerId,
    strategy: 'file-lock',
    viaFallback: true,
    resource: FALLBACK_LOCK_PATH,
    acquiredAt: record.acquiredAt,
    expiresAt: record.expiresAt,
    ttlMillis,
    heartbeatIntervalMs: effectiveHeartbeat,
    nextHeartbeatAt,
    renewAttempt,
  };
};

const captureFallbackConflictLease = (
  record: FallbackLockLeaseRecord,
  ctx: AcquireContext
): ProjectLockLease => {
  const lease = fallbackRecordToLease(record);
  ctx.conflictLease = lease;
  return lease;
};

const readFallbackLeaseSnapshot = async (): Promise<ProjectLockLease | undefined> => {
  try {
    const record = (await loadJSON(FALLBACK_LOCK_PATH)) as FallbackLockLeaseRecord | null;
    if (!record) return undefined;
    return fallbackRecordToLease(record);
  } catch {
    return undefined;
  }
};
const acquireViaWebLock = async (ctx: AcquireContext): Promise<ProjectLockLease> => {
  const locks = (globalThis as typeof globalThis & { navigator?: Navigator }).navigator?.locks;
  if (!locks?.request)
    throw makeError('web-lock-unsupported', 'Web Locks API unavailable', 'acquire', true);

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
          : makeError(
              'release-failed',
              'Web Lock request completion rejected',
              'release',
              error.retryable,
              error,
            )
        : makeError('release-failed', 'Web Lock request completion rejected', 'release', true, error);
  };

  const awaitReleased = async (released: Promise<unknown> | undefined) => {
    if (!released) return;
    try {
      await released;
    } catch (error) {
      if (!releaseError) {
        releaseError =
          error instanceof ProjectLockError
            ? error.operation === 'release'
              ? error
              : makeError('release-failed', 'Web Lock released promise rejected', 'release', error.retryable, error)
            : makeError('release-failed', 'Web Lock released promise rejected', 'release', true, error);
      }
    }
  };

  const toReleaseProjectError = (error: unknown): ProjectLockError =>
    error instanceof ProjectLockError && error.operation === 'release'
      ? error
      : makeError('release-failed', 'Web Lock release invocation failed', 'release', true, error);

  const requestCallback = async (lock: unknown) => {
    if (!lock || typeof lock !== 'object') {
      throw makeError('acquire-denied', 'Web Lock handle missing', 'acquire', false);
    }

    type WebLockHandle = {
      released?: unknown;
      release?: () => Promise<void> | void;
    };
    const handle = lock as WebLockHandle;
    const released = handle.released;
    releasedPromise =
      released && typeof (released as Promise<unknown>).then === 'function'
        ? (released as Promise<unknown>)
        : Promise.resolve();
    type ReleaseMethod = () => Promise<void> | void;
    const releaseMethod: ReleaseMethod | undefined =
      typeof handle.release === 'function'
        ? ((handle.release as ReleaseMethod).bind(handle) as ReleaseMethod)
        : undefined;

    webLockHandles.set(ctx.leaseId, {
      release: async () => {
        if (releaseInvoked && !lastReleaseError) return;
        releaseInvoked = true;
        const previousError = lastReleaseError;
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
      getReleaseError: () => lastReleaseError,
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
          projectError,
        );
      }
      if (!completionDeferred.isSettled()) completionDeferred.reject(projectError);
      throw projectError;
    });
  const completion = (async () => {
    await releaseDeferred.promise;
    await awaitReleased(releasedPromise);
    await requestOutcome;
  })();
  completion.then(
    () => {
      if (!completionDeferred.isSettled()) completionDeferred.resolve();
    },
    (error) => {
      captureCompletionError(error);
      if (!completionDeferred.isSettled()) completionDeferred.reject(error);
    },
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

const acquireViaFallback = async (ctx: AcquireContext): Promise<ProjectLockLease> => {
  const signal = ctx.signal;
  let aborted = false;
  let rejectOnAbort: ((error: ProjectLockError) => void) | undefined;
  const abortError = () =>
    makeError('acquire-denied', 'Fallback acquisition aborted', 'acquire', true, signal?.reason);
  const throwIfAborted = () => {
    if ((signal?.aborted ?? false) || aborted) {
      throw abortError();
    }
  };

  const onAbort = () => {
    aborted = true;
    if (rejectOnAbort) {
      const error = abortError();
      rejectOnAbort(error);
      rejectOnAbort = undefined;
    }
  };

  if (signal?.aborted) {
    throw abortError();
  }

  const abortAwaitable: Promise<never> | undefined = signal
    ? new Promise<never>((_, reject) => {
        rejectOnAbort = reject;
      })
    : undefined;

  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const now = Date.now();
    throwIfAborted();
    const record = (await loadJSON(FALLBACK_LOCK_PATH)) as FallbackLockLeaseRecord | null;
    throwIfAborted();

    if (record && record.leaseId !== ctx.leaseId && record.expiresAt > now) {
      const lease = captureFallbackConflictLease(record, ctx);
      projectLockEvents.emit({
        type: 'lock:warning',
        lease,
        warning: 'fallback-degraded',
        detail: 'Existing fallback lease still active',
      });
      throw makeError('fallback-conflict', 'Fallback lock already held', 'acquire', true);
    }

    const ttl = ctx.ttlMs ?? FALLBACK_LOCK_TTL_MS;
    const ttlSeconds = ttl / 1000;
    const isReentrantActiveLease =
      record !== null && record.leaseId === ctx.leaseId && record.expiresAt > now;
    const acquiredAt = isReentrantActiveLease ? record.acquiredAt : now;
    const heartbeatInterval = ctx.heartbeatMs > 0 ? ctx.heartbeatMs : LOCK_HEARTBEAT_INTERVAL_MS;
    const expiresAt = now + ttl;
    const scheduledHeartbeatAt = scheduleNextHeartbeat(expiresAt, now, ttl, acquiredAt);
    const next: FallbackLockLeaseRecord = {
      leaseId: ctx.leaseId,
      ownerId: ctx.ownerId,
      acquiredAt,
      expiresAt,
      ttlSeconds, // ← ttlSecondsを正しく記録
      mtime: now,
      heartbeatIntervalMs: heartbeatInterval,
      nextHeartbeatAt: scheduledHeartbeatAt,
    };

    throwIfAborted();
    const writePromise = saveJSON(FALLBACK_LOCK_PATH, next);
    if (abortAwaitable) {
      await Promise.race([writePromise, abortAwaitable]);
      rejectOnAbort = undefined;
    } else {
      await writePromise;
    }
    throwIfAborted();

    return buildLease('file-lock', FALLBACK_LOCK_PATH, ttl, ctx.heartbeatMs, ctx, acquiredAt);
  } finally {
    rejectOnAbort = undefined;
    signal?.removeEventListener('abort', onAbort);
  }

};

const removeFallbackFile=async():Promise<void>=>{try{const root=await getRoot();const segments=FALLBACK_LOCK_PATH.split('/').filter(Boolean);const file=segments.pop();if(!file)return;let dir:FileSystemDirectoryHandle=root;for(const segment of segments)dir=await dir.getDirectoryHandle(segment,{create:false});await dir.removeEntry(file);}catch(error){if((error as DOMException)?.name!=='NotFoundError')throw error;}};
const releaseFallbackLease=async(lease:ProjectLockLease,force?:boolean):Promise<void>=>{const record=(await loadJSON(FALLBACK_LOCK_PATH)) as FallbackLockLeaseRecord|null;if(!force&&record&&record.leaseId!==lease.leaseId&&record.expiresAt>Date.now())throw makeError('lease-stale','Fallback lease owned by another client','release',false);await removeFallbackFile();};
export const acquireProjectLock: AcquireProjectLock = async (options = {}) => {
  const ctx: AcquireContext = {
    leaseId: crypto.randomUUID(),
    ownerId: crypto.randomUUID(),
    ttlMs: options.ttlMs,
    heartbeatMs: options.heartbeatIntervalMs ?? LOCK_HEARTBEAT_INTERVAL_MS,
    signal: options.signal,
  };
  const backoff = { ...defaultBackoff, ...options.backoff };
  const maxAttempts = options.retry === false ? 1 : backoff.maxAttempts;
  let allowWeb = options.preferredStrategy !== 'file-lock';
  let delay = backoff.initialDelayMs;
  let fallbackNotified = false;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const order: LockAcquisitionStrategy[] =
      options.preferredStrategy === 'file-lock' ? ['file-lock'] : ['web-lock', 'file-lock'];

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
          (options.signal?.aborted === true ||
            isAbortReason(options.signal?.reason) ||
            isAbortReason(baseError.cause));
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
    storedInterval > 0
      ? storedInterval
      : Math.max(0, lease.nextHeartbeatAt - renewalAnchor);
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
      const record = (await loadJSON(FALLBACK_LOCK_PATH)) as FallbackLockLeaseRecord | null;
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

  const currentState = getReleaseFailure(lease.leaseId);
  if (currentState && currentState.attempts >= releaseBackoff.maxAttempts) {
    if (!currentState.readonlyNotified) {
      emitReadonly('release-failed', currentState.lastError, options.onReadonly);
      currentState.readonlyNotified = true;
    }
    throw currentState.lastError;
  }

  if (currentState?.nextDelayMs) {
    await awaitReleaseDelay(currentState.nextDelayMs, options.signal);
  }

  const handle = lease.strategy === 'web-lock' ? webLockHandles.get(lease.leaseId) : undefined;
  const existingReleaseError = handle?.getReleaseError();

  const processFailure = (error: ProjectLockError) => {
    const previous = getReleaseFailure(lease.leaseId);
    const attempts = (previous?.attempts ?? 0) + 1;
    const alreadyReadonly = previous?.readonlyNotified ?? false;
    const isDeferredReadonly = shouldDeferReadonlyForRelease(error, attempts);
    const shouldEmitReadonly = !alreadyReadonly && !isDeferredReadonly;
    const nextDelay = attempts < releaseBackoff.maxAttempts ? computeReleaseDelay(attempts + 1) : 0;
    const state = rememberReleaseFailure(
      lease.leaseId,
      error,
      attempts,
      alreadyReadonly || shouldEmitReadonly,
      nextDelay
    );
    emitError(error);
    if (shouldEmitReadonly) emitReadonly('release-failed', error, options.onReadonly);
    return state;
  };

  projectLockEvents.emit({ type: 'lock:release-requested', lease });

  if (existingReleaseError && !currentState) {
    const state = processFailure(existingReleaseError);
    throw state.lastError;
  }

  try {
    if (lease.strategy === 'web-lock') {
      if (handle) {
        await handle.release();
        webLockHandles.delete(lease.leaseId);
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
    const state = processFailure(projectError);
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
  const lease = await acquireProjectLock(options);
  const releaseOnError = options.releaseOnError !== false;
  try {
    const result = await executor(lease);
    await safeRelease(lease, options, false);
    return result;
  } catch (error) {
    if (error instanceof ProjectLockError) {
      emitError(error);
      if (!error.retryable)
        emitReadonly(reasonFromOperation(error.operation), error, options.onReadonly);
    }
    if (!releaseOnError) throw error;
    await safeRelease(lease, options, false);
    throw error;
  }
};
export const projectLockApi:ProjectLockApi=Object.freeze({events:projectLockEvents,acquire:acquireProjectLock,renew:renewProjectLock,release:releaseProjectLock,withProjectLock});
