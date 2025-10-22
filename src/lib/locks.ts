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
  /** Web Lock key or fallback namespaced path, depending on the strategy. */
  readonly resource: string;
  /** Millisecond timestamp when the lease was first granted. */
  readonly acquiredAt: number;
  /** Millisecond timestamp when the lease expires without renewal. */
  readonly expiresAt: number;
  /** TTL negotiated at acquisition time. */
  readonly ttlMillis: number;
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
    }
  | {
      readonly type: 'lock:readonly-entered';
      readonly reason: ProjectLockReadonlyReason;
      readonly lastError: ProjectLockError;
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
  /** Optional callback invoked when the lock layer transitions to read-only. */
  readonly onReadonly?: (reason: ProjectLockError) => void;
}

export interface RenewProjectLockOptions { readonly signal?: AbortSignal; }

export interface ReleaseProjectLockOptions { readonly signal?: AbortSignal; readonly force?: boolean; }

export interface WithProjectLockOptions extends AcquireProjectLockOptions { readonly renewIntervalMs?: number; readonly releaseOnError?: boolean; }

export type AcquireProjectLock = (options?: AcquireProjectLockOptions) => Promise<ProjectLockLease>;

export type RenewProjectLock = (lease: ProjectLockLease, options?: RenewProjectLockOptions) => Promise<ProjectLockLease>;

export type ReleaseProjectLock = (lease: ProjectLockLease, options?: ReleaseProjectLockOptions) => Promise<void>;

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
