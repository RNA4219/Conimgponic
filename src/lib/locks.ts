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
  /** Optional callback invoked when the lock layer transitions to read-only. */
  readonly onReadonly?: (reason: ProjectLockError) => void;
}

export interface RenewProjectLockOptions { readonly signal?: AbortSignal; }

export interface ReleaseProjectLockOptions { readonly signal?: AbortSignal; readonly force?: boolean; }

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
    ttlSeconds: { type: 'integer', const: 30 },
    mtime: { type: 'integer', minimum: 0 },
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

const defaultBackoff: BackoffPolicy={initialDelayMs:500,factor:2,maxAttempts:MAX_LOCK_RETRIES};
const listeners=new Set<ProjectLockEventListener>();
export const projectLockEvents:ProjectLockEventTarget={subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},emit(event){listeners.forEach(fn=>fn(event));}};
const webLockHandles=new Map<string,{release:()=>Promise<void>}>();
const fallbackTtlSeconds=Math.round(FALLBACK_LOCK_TTL_MS/1000);
type AcquireContext={readonly leaseId:string;readonly ownerId:string;readonly ttlMs?:number;readonly heartbeatMs:number;readonly signal?:AbortSignal};
const makeError=(code:ProjectLockErrorCode,message:string,operation:ProjectLockOperation,retryable:boolean,cause?:unknown)=>new ProjectLockError(code,message,{operation,retryable,cause});
const emitReadonly=(reason:ProjectLockReadonlyReason,error:ProjectLockError,onReadonly?: (err:ProjectLockError)=>void)=>{projectLockEvents.emit({type:'lock:readonly-entered',reason,lastError:error,retryable:false});onReadonly?.(error);};
const reasonFromOperation=(operation:ProjectLockOperation):ProjectLockReadonlyReason=>operation==='acquire'?'acquire-failed':operation==='renew'?'renew-failed':'release-failed';
const buildLease=(strategy:LockAcquisitionStrategy,resource:string,ttl:number,heartbeatMs:number,ctx:AcquireContext,acquiredAt=Date.now(),renewAttempt=0):ProjectLockLease=>{const now=Date.now();return{leaseId:ctx.leaseId,ownerId:ctx.ownerId,strategy,resource,acquiredAt,expiresAt:now+ttl,ttlMillis:ttl,nextHeartbeatAt:now+heartbeatMs,renewAttempt};};
const acquireViaWebLock=async (ctx:AcquireContext):Promise<ProjectLockLease>=>{const locks=(globalThis as typeof globalThis&{navigator?:Navigator}).navigator?.locks as{request?:(...args:readonly unknown[])=>Promise<unknown>}|undefined;if(!locks?.request)throw makeError('web-lock-unsupported','Web Locks API unavailable','acquire',true);let handle:unknown;try{handle=locks.request.length>=3?await locks.request(WEB_LOCK_KEY,{mode:'exclusive',signal:ctx.signal},async(lock:unknown)=>lock):await locks.request(WEB_LOCK_KEY,{mode:'exclusive',signal:ctx.signal});}catch(cause){throw makeError('acquire-denied','Web Lock request rejected','acquire',true,cause);}if(!handle||typeof(handle as{release?:unknown}).release!=='function')throw makeError('acquire-denied','Web Lock handle missing release','acquire',false);webLockHandles.set(ctx.leaseId,handle as{release:()=>Promise<void>});return buildLease('web-lock',WEB_LOCK_KEY,ctx.ttlMs??WEB_LOCK_TTL_MS,ctx.heartbeatMs,ctx);};
const acquireViaFallback=async (ctx:AcquireContext):Promise<ProjectLockLease>=>{const now=Date.now();const record=(await loadJSON(FALLBACK_LOCK_PATH)) as FallbackLockLeaseRecord|null;if(record&&record.leaseId!==ctx.leaseId&&record.expiresAt>now){projectLockEvents.emit({type:'lock:warning',lease:buildLease('file-lock',FALLBACK_LOCK_PATH,ctx.ttlMs??FALLBACK_LOCK_TTL_MS,ctx.heartbeatMs,ctx,record.acquiredAt),warning:'fallback-degraded',detail:'Existing fallback lease still active'});throw makeError('fallback-conflict','Fallback lock already held','acquire',true);}const ttl=ctx.ttlMs??FALLBACK_LOCK_TTL_MS;const next:FallbackLockLeaseRecord={leaseId:ctx.leaseId,ownerId:ctx.ownerId,acquiredAt:record?.acquiredAt??now,expiresAt:now+ttl,ttlSeconds:fallbackTtlSeconds,mtime:now};await saveJSON(FALLBACK_LOCK_PATH,next);return buildLease('file-lock',FALLBACK_LOCK_PATH,ttl,ctx.heartbeatMs,ctx,next.acquiredAt);};
const removeFallbackFile=async():Promise<void>=>{try{const root=await getRoot();const segments=FALLBACK_LOCK_PATH.split('/').filter(Boolean);const file=segments.pop();if(!file)return;let dir:FileSystemDirectoryHandle=root;for(const segment of segments)dir=await dir.getDirectoryHandle(segment,{create:false});await dir.removeEntry(file);}catch(error){if((error as DOMException)?.name!=='NotFoundError')throw error;}};
const releaseFallbackLease=async(lease:ProjectLockLease,force?:boolean):Promise<void>=>{const record=(await loadJSON(FALLBACK_LOCK_PATH)) as FallbackLockLeaseRecord|null;if(!force&&record&&record.leaseId!==lease.leaseId&&record.expiresAt>Date.now())throw makeError('lease-stale','Fallback lease owned by another client','release',false);await removeFallbackFile();};
export const acquireProjectLock:AcquireProjectLock=async(options={})=>{const ctx:AcquireContext={leaseId:crypto.randomUUID(),ownerId:crypto.randomUUID(),ttlMs:options.ttlMs,heartbeatMs:options.heartbeatIntervalMs??LOCK_HEARTBEAT_INTERVAL_MS,signal:options.signal};const backoff={...defaultBackoff,...options.backoff};let allowWeb=options.preferredStrategy!=='file-lock';let delay=backoff.initialDelayMs;let fallbackNotified=false;for(let attempt=0;attempt<backoff.maxAttempts;attempt+=1){const order:LockAcquisitionStrategy[]=options.preferredStrategy==='file-lock'?['file-lock']:['web-lock','file-lock'];for(const strategy of order){if(strategy==='web-lock'&&!allowWeb)continue;projectLockEvents.emit({type:'lock:attempt',strategy,retry:attempt});try{const lease=strategy==='web-lock'?await acquireViaWebLock(ctx):await acquireViaFallback(ctx);if(lease.strategy==='file-lock'&&!fallbackNotified){projectLockEvents.emit({type:'lock:fallback-engaged',lease});fallbackNotified=true;}projectLockEvents.emit({type:'lock:acquired',lease});return lease;}catch(error){const projectError=error instanceof ProjectLockError?error:makeError('acquire-denied','Project lock acquisition failed','acquire',true,error);projectLockEvents.emit({type:'lock:error',operation:'acquire',error:projectError,retryable:projectError.retryable});if(strategy==='web-lock'&&projectError.code==='web-lock-unsupported'){allowWeb=false;continue;}if(!projectError.retryable||attempt===backoff.maxAttempts-1){emitReadonly('acquire-failed',projectError,options.onReadonly);throw projectError;}}}if(attempt<backoff.maxAttempts-1){projectLockEvents.emit({type:'lock:waiting',retry:attempt,delayMs:delay});await new Promise<void>(resolve=>setTimeout(resolve,delay));delay*=backoff.factor;}}const finalError=makeError('acquire-timeout','Exhausted project lock retries','acquire',false);emitReadonly('acquire-failed',finalError,options.onReadonly);throw finalError;};
export const renewProjectLock:RenewProjectLock=async(lease,options={})=>{if(options.signal?.aborted)throw makeError('renew-failed','Renew aborted by signal','renew',true,options.signal.reason);const now=Date.now();projectLockEvents.emit({type:'lock:renew-scheduled',lease,nextHeartbeatInMs:Math.max(0,lease.nextHeartbeatAt-now)});if(now>lease.nextHeartbeatAt)projectLockEvents.emit({type:'lock:warning',lease,warning:'heartbeat-delayed',detail:`Renew heartbeat delayed by ${now-lease.nextHeartbeatAt}ms`});try{if(lease.strategy==='file-lock'){const record=(await loadJSON(FALLBACK_LOCK_PATH)) as FallbackLockLeaseRecord|null;if(!record||record.leaseId!==lease.leaseId)throw makeError('lease-stale','Fallback lease missing for renew','renew',false);await saveJSON(FALLBACK_LOCK_PATH,{...record,expiresAt:now+lease.ttlMillis,mtime:now});}const nextExpires=Math.max(lease.expiresAt+1,now+lease.ttlMillis);const refreshed:ProjectLockLease={...lease,expiresAt:nextExpires,nextHeartbeatAt:now+LOCK_HEARTBEAT_INTERVAL_MS,renewAttempt:lease.renewAttempt+1};projectLockEvents.emit({type:'lock:renewed',lease:refreshed});return refreshed;}catch(error){const projectError=error instanceof ProjectLockError?error:makeError('renew-failed','Failed to renew project lock','renew',true,error);projectLockEvents.emit({type:'lock:error',operation:'renew',error:projectError,retryable:projectError.retryable});if(!projectError.retryable)emitReadonly('renew-failed',projectError);throw projectError;}};
export const releaseProjectLock:ReleaseProjectLock=async(lease,options={})=>{if(options.signal?.aborted)throw makeError('release-failed','Release aborted by signal','release',true,options.signal.reason);projectLockEvents.emit({type:'lock:release-requested',lease});try{if(lease.strategy==='web-lock'){const handle=webLockHandles.get(lease.leaseId);if(handle){await handle.release();webLockHandles.delete(lease.leaseId);}}else await releaseFallbackLease(lease,options.force);projectLockEvents.emit({type:'lock:released',leaseId:lease.leaseId});}catch(error){const projectError=error instanceof ProjectLockError?error:makeError('release-failed','Failed to release project lock','release',true,error);projectLockEvents.emit({type:'lock:error',operation:'release',error:projectError,retryable:projectError.retryable});emitReadonly('release-failed',projectError);throw projectError;}};
const safeRelease=async(lease:ProjectLockLease,options:WithProjectLockOptions,force:boolean)=>{try{await releaseProjectLock(lease,{signal:options.signal,force});}catch(error){const projectError=error instanceof ProjectLockError?error:makeError('release-failed','Failed to release project lock','release',true,error);if(!projectError.retryable)emitReadonly('release-failed',projectError,options.onReadonly);throw projectError;}};
export const withProjectLock:WithProjectLock=async(executor,options={})=>{const lease=await acquireProjectLock(options);try{const result=await executor(lease);await safeRelease(lease,options,false);return result;}catch(error){if(error instanceof ProjectLockError&&!error.retryable)emitReadonly(reasonFromOperation(error.operation),error,options.onReadonly);await safeRelease(lease,options,options.releaseOnError??true);throw error;}};
export const projectLockApi:ProjectLockApi=Object.freeze({events:projectLockEvents,acquire:acquireProjectLock,renew:renewProjectLock,release:releaseProjectLock,withProjectLock});
