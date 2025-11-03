export const WEB_LOCK_KEY = 'imgponic:project';
export const WEB_LOCK_TTL_MS = 25_000;
export const FALLBACK_LOCK_PATH = 'project/.lock';
export const FALLBACK_LOCK_TTL_MS = 30_000;
export const LOCK_HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_LEAD_MS = 5_000;
export const MAX_LOCK_RETRIES = 3;

export type LockAcquisitionStrategy = 'web-lock' | 'file-lock';

export interface ProjectLockLease {
  readonly leaseId: string;
  readonly ownerId: string;
  readonly strategy: LockAcquisitionStrategy;
  readonly viaFallback: boolean;
  readonly resource: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
  readonly ttlMillis: number;
  readonly heartbeatIntervalMs: number;
  readonly nextHeartbeatAt: number;
  readonly renewAttempt: number;
}

export type ProjectLockReadonlyReason = 'acquire-failed' | 'renew-failed' | 'release-failed';

export type ProjectLockWarningKind = 'fallback-engaged' | 'fallback-degraded' | 'heartbeat-delayed';

export type ProjectLockEvent =
  | { readonly type: 'lock:attempt'; readonly strategy: LockAcquisitionStrategy; readonly retry: number }
  | { readonly type: 'lock:waiting'; readonly retry: number; readonly delayMs: number }
  | { readonly type: 'lock:acquired'; readonly lease: ProjectLockLease }
  | { readonly type: 'lock:renew-scheduled'; readonly lease: ProjectLockLease; readonly nextHeartbeatInMs: number }
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

export interface BackoffPolicy {
  readonly initialDelayMs: number;
  readonly factor: number;
  readonly maxAttempts: number;
}

export interface AcquireProjectLockOptions {
  readonly signal?: AbortSignal;
  readonly ttlMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly preferredStrategy?: LockAcquisitionStrategy;
  readonly backoff?: Partial<BackoffPolicy>;
  readonly retry?: boolean;
  readonly onReadonly?: (reason: ProjectLockError) => void;
}

export interface RenewProjectLockOptions {
  readonly signal?: AbortSignal;
  /**
   * renew 処理が非リトライエラーで readonly に移行する際の通知先。
   *
   * acquire/release と同様に、ProjectLockError をアプリ層へ伝播する。
   */
  readonly onReadonly?: (error: ProjectLockError) => void;
}

export interface ReleaseProjectLockOptions {
  readonly signal?: AbortSignal;
  readonly force?: boolean;
  readonly onReadonly?: (error: ProjectLockError) => void;
}

export interface WithProjectLockOptions extends AcquireProjectLockOptions {
  readonly renewIntervalMs?: number;
  readonly releaseOnError?: boolean;
}

export type AcquireProjectLock = (options?: AcquireProjectLockOptions) => Promise<ProjectLockLease>;
export type RenewProjectLock = (
  lease: ProjectLockLease,
  options?: RenewProjectLockOptions
) => Promise<ProjectLockLease>;
export type ReleaseProjectLock = (lease: ProjectLockLease, options?: ReleaseProjectLockOptions) => Promise<void>;
export type WithProjectLock = <T>(
  executor: (lease: ProjectLockLease) => Promise<T>,
  options?: WithProjectLockOptions
) => Promise<T>;

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

const notifiedLockErrors = new WeakSet<ProjectLockError>();
const readonlyNotifiedLockErrors = new WeakSet<ProjectLockError>();

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

export interface ProjectLockStateTransition {
  readonly state: 'idle' | 'acquiring:web-lock' | 'acquiring:file-lock' | 'acquired' | 'renewing' | 'releasing' | 'readonly';
  readonly action: 'request' | 'fallback' | 'lease-established' | 'heartbeat' | 'timeout' | 'force-release' | 'error';
  readonly next: ProjectLockStateTransition['state'];
  readonly retryable: boolean;
  readonly notes: string;
}

export const PROJECT_LOCK_STATE_MACHINE: readonly ProjectLockStateTransition[] = Object.freeze([
  {
    state: 'idle',
    action: 'request',
    next: 'acquiring:web-lock',
    retryable: true,
    notes:
      'Primary acquisition attempts Web Locks first with ttl=25s (or ttlMs override) and max 3 retries using exponential backoff.',
  },
  {
    state: 'acquiring:web-lock',
    action: 'fallback',
    next: 'acquiring:file-lock',
    retryable: true,
    notes:
      'When navigator.locks is unavailable or denied, switch to project/.lock using a shared leaseId, ttl=30s, and collision detection.',
  },
  {
    state: 'acquiring:file-lock',
    action: 'lease-established',
    next: 'acquired',
    retryable: true,
    notes:
      'Successful acquisition schedules heartbeats every 10s and records expiresAt based on negotiated ttl.',
  },
  {
    state: 'acquired',
    action: 'heartbeat',
    next: 'renewing',
    retryable: true,
    notes:
      'Heartbeats renew both lock mechanisms ahead of ttl expiry; delays trigger lock:warning events with retry guidance.',
  },
  {
    state: 'renewing',
    action: 'timeout',
    next: 'readonly',
    retryable: false,
    notes: 'Renewals that miss ttlSeconds demote AutoSave to read-only and require user notification per docs/AUTOSAVE-DESIGN-IMPL.md.',
  },
  {
    state: 'renewing',
    action: 'lease-established',
    next: 'acquired',
    retryable: true,
    notes:
      'Renew success updates renewAttempt and schedules the next heartbeat based on heartbeatIntervalMs.',
  },
  {
    state: 'acquired',
    action: 'force-release',
    next: 'releasing',
    retryable: true,
    notes: 'Forced release bypasses Web Lock release but must unlink the fallback file to avoid stale leases.',
  },
  {
    state: 'releasing',
    action: 'lease-established',
    next: 'idle',
    retryable: true,
    notes: 'Release completion resets retry counters and clears scheduled renewals, returning to idle.',
  },
  {
    state: 'acquiring:web-lock',
    action: 'error',
    next: 'readonly',
    retryable: false,
    notes: 'Acquisition errors after maxAttempts=3 trigger read-only mode and UI banner with retry CTA.',
  },
  {
    state: 'acquiring:file-lock',
    action: 'error',
    next: 'readonly',
    retryable: false,
    notes: 'Fallback collisions detected via leaseId/mtime comparison keep the project in read-only to prevent split-brain writes.',
  },
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

export interface AcquireContext {
  readonly leaseId: string;
  readonly ownerId: string;
  readonly ttlMs?: number;
  readonly heartbeatMs: number;
  readonly signal?: AbortSignal;
  conflictLease?: ProjectLockLease;
}

export const makeError = (
  code: ProjectLockErrorCode,
  message: string,
  operation: ProjectLockOperation,
  retryable: boolean,
  cause?: unknown
): ProjectLockError => new ProjectLockError(code, message, { operation, retryable, cause });

export const scheduleNextHeartbeat = (
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

export const buildLease = (
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

export const fallbackRecordToLease = (record: FallbackLockLeaseRecord): ProjectLockLease => {
  const ttlMillis = Math.max(0, Math.round(record.ttlSeconds * 1000));
  const storedHeartbeat = record.heartbeatIntervalMs ?? 0;
  const effectiveHeartbeat = storedHeartbeat > 0 ? storedHeartbeat : LOCK_HEARTBEAT_INTERVAL_MS;
  const storedNextHeartbeat = record.nextHeartbeatAt ?? 0;
  const computedNextHeartbeat = scheduleNextHeartbeat(record.expiresAt, record.mtime, ttlMillis, record.acquiredAt);
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

export const emitError = (error: ProjectLockError): void => {
  projectLockEvents.emit({ type: 'lock:error', operation: error.operation, error, retryable: error.retryable });
  notifiedLockErrors.add(error);
};

export const hasErrorEventBeenEmitted = (error: ProjectLockError): boolean => notifiedLockErrors.has(error);

export const emitReadonly = (
  reason: ProjectLockReadonlyReason,
  error: ProjectLockError,
  onReadonly?: (err: ProjectLockError) => void
): void => {
  if (!readonlyNotifiedLockErrors.has(error)) {
    projectLockEvents.emit({ type: 'lock:readonly-entered', reason, lastError: error, retryable: false });
    readonlyNotifiedLockErrors.add(error);
  }
  onReadonly?.(error);
};

export const reasonFromOperation = (operation: ProjectLockOperation): ProjectLockReadonlyReason =>
  operation === 'acquire' ? 'acquire-failed' : operation === 'renew' ? 'renew-failed' : 'release-failed';

export const isAbortReason = (reason: unknown): boolean => {
  if (!reason) return false;
  if (reason instanceof DOMException) return reason.name === 'AbortError';
  if (reason instanceof Error) return reason.name === 'AbortError';
  return typeof reason === 'string' && reason === 'AbortError';
};

export const createAbortError = (
  base: ProjectLockError,
  signal: AbortSignal | undefined
): ProjectLockError => {
  if (!base.retryable) return base;
  const cause = base.cause ?? signal?.reason ?? base;
  return makeError('acquire-denied', 'Project lock acquisition aborted', 'acquire', true, cause);
};
