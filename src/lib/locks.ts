export const WEB_LOCK_KEY = 'imgponic:project';
export const WEB_LOCK_TTL_MS = 25_000;
export const FALLBACK_LOCK_PATH = 'project/.lock';
export const FALLBACK_LOCK_TTL_MS = 30_000;
export const LOCK_HEARTBEAT_INTERVAL_MS = 10_000;
export const MAX_LOCK_RETRIES = 3;

export type LockAcquisitionStrategy = 'web-lock' | 'file-lock';

export interface ProjectLockLease {
  readonly leaseId: string;
  readonly ownerId: string;
  readonly strategy: LockAcquisitionStrategy;
  readonly acquiredAt: number;
  readonly expiresAt: number;
  readonly ttlMillis: number;
  readonly renewAttempt: number;
}

export type ProjectLockEvent =
  | { readonly type: 'lock:attempt'; readonly strategy: LockAcquisitionStrategy; readonly retry: number }
  | { readonly type: 'lock:acquired'; readonly lease: ProjectLockLease }
  | { readonly type: 'lock:renew-scheduled'; readonly lease: ProjectLockLease; readonly nextHeartbeatInMs: number }
  | { readonly type: 'lock:renewed'; readonly lease: ProjectLockLease }
  | { readonly type: 'lock:release-requested'; readonly lease: ProjectLockLease }
  | { readonly type: 'lock:released'; readonly leaseId: string }
  | { readonly type: 'lock:readonly-entered'; readonly reason: 'acquire-failed' | 'renew-failed' | 'release-failed'; readonly lastError: ProjectLockError };

export type ProjectLockEventListener = (event: ProjectLockEvent) => void;

export interface ProjectLockEventTarget { subscribe(listener: ProjectLockEventListener): () => void; emit(event: ProjectLockEvent): void; }

export interface BackoffPolicy { readonly initialDelayMs: number; readonly factor: number; readonly maxAttempts: number; }

export interface AcquireProjectLockOptions {
  readonly signal?: AbortSignal;
  readonly preferredStrategy?: LockAcquisitionStrategy;
  readonly backoff?: Partial<BackoffPolicy>;
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

  constructor(code: ProjectLockErrorCode, message: string, options: { retryable: boolean; cause?: unknown }) {
    super(message);
    this.code = code;
    this.retryable = options.retryable;
    this.cause = options.cause;
    this.name = 'ProjectLockError';
  }
}
