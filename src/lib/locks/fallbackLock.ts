import { getRoot, loadJSON, saveJSON } from '../opfs.js';
import type { ProjectLockError } from './shared.js';
import {
  FALLBACK_LOCK_PATH,
  FALLBACK_LOCK_TTL_MS,
  LOCK_HEARTBEAT_INTERVAL_MS,
  ProjectLockLease,
  AcquireContext,
  projectLockEvents,
  makeError,
  scheduleNextHeartbeat,
  buildLease,
  fallbackRecordToLease,
} from './shared.js';

export type FallbackRecord = Parameters<typeof fallbackRecordToLease>[0];

export const readFallbackLeaseSnapshot = async (): Promise<ProjectLockLease | undefined> => {
  try {
    const record = (await loadJSON(FALLBACK_LOCK_PATH)) as FallbackRecord | null;
    if (!record) return undefined;
    return fallbackRecordToLease(record);
  } catch {
    return undefined;
  }
};

const removeFallbackFile = async (): Promise<void> => {
  try {
    const root = await getRoot();
    const segments = FALLBACK_LOCK_PATH.split('/').filter(Boolean);
    const file = segments.pop();
    if (!file) return;
    let dir: FileSystemDirectoryHandle = root;
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create: false });
    }
    await dir.removeEntry(file);
  } catch (error) {
    if ((error as DOMException | undefined)?.name !== 'NotFoundError') throw error;
  }
};

export const releaseFallbackLease = async (lease: ProjectLockLease, force?: boolean): Promise<void> => {
  const record = (await loadJSON(FALLBACK_LOCK_PATH)) as FallbackRecord | null;
  if (!force && record && record.leaseId !== lease.leaseId && record.expiresAt > Date.now()) {
    throw makeError('lease-stale', 'Fallback lease owned by another client', 'release', false);
  }
  await removeFallbackFile();
};

export const acquireViaFallback = async (ctx: AcquireContext): Promise<ProjectLockLease> => {
  const signal = ctx.signal;
  let aborted = false;
  let rejectOnAbort: ((error: ProjectLockError) => void) | undefined;
  const abortError = () => makeError('acquire-denied', 'Fallback acquisition aborted', 'acquire', true, signal?.reason);
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

  let writeTask: Promise<void> | undefined;
  let wroteFallbackRecord = false;

  const cleanupAbortedFallback = async () => {
    if (!((signal?.aborted ?? false) || aborted)) {
      return;
    }
    if (!writeTask) {
      return;
    }
    try {
      await writeTask.catch(() => undefined);
    } catch {
      // Ignore write errors once abort has been signalled.
    }
    if (!wroteFallbackRecord) {
      return;
    }
    try {
      await removeFallbackFile();
    } catch {
      // Best-effort cleanup; ignore removal errors during abort.
    }
  };

  try {
    const now = Date.now();
    throwIfAborted();
    const record = (await loadJSON(FALLBACK_LOCK_PATH)) as FallbackRecord | null;
    throwIfAborted();

    if (record && record.leaseId !== ctx.leaseId && record.expiresAt > now) {
      const lease = fallbackRecordToLease(record);
      ctx.conflictLease = lease;
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
    const isReentrantActiveLease = record !== null && record.leaseId === ctx.leaseId && record.expiresAt > now;
    const acquiredAt = isReentrantActiveLease ? record.acquiredAt : now;
    const heartbeatInterval = ctx.heartbeatMs > 0 ? ctx.heartbeatMs : LOCK_HEARTBEAT_INTERVAL_MS;
    const expiresAt = now + ttl;
    const scheduledHeartbeatAt = scheduleNextHeartbeat(expiresAt, now, ttl, acquiredAt);
    const nextRecord: FallbackRecord = {
      leaseId: ctx.leaseId,
      ownerId: ctx.ownerId,
      acquiredAt,
      expiresAt,
      ttlSeconds,
      mtime: now,
      heartbeatIntervalMs: heartbeatInterval,
      nextHeartbeatAt: scheduledHeartbeatAt,
    };

    throwIfAborted();
    writeTask = (async () => {
      await saveJSON(FALLBACK_LOCK_PATH, nextRecord);
      wroteFallbackRecord = true;
    })();
    if (abortAwaitable) {
      await Promise.race([writeTask, abortAwaitable]);
      rejectOnAbort = undefined;
    } else {
      await writeTask;
    }
    throwIfAborted();

    return buildLease('file-lock', FALLBACK_LOCK_PATH, ttl, ctx.heartbeatMs, ctx, acquiredAt);
  } catch (error) {
    await cleanupAbortedFallback();
    throw error;
  } finally {
    rejectOnAbort = undefined;
    signal?.removeEventListener('abort', onAbort);
  }
};
