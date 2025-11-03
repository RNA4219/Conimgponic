import { loadJSON, saveJSON } from '../opfs.js';
import {
  FALLBACK_LOCK_PATH,
  LOCK_HEARTBEAT_INTERVAL_MS,
  ProjectLockError,
  emitError,
  emitReadonly,
  makeError,
  projectLockEvents,
  scheduleNextHeartbeat,
  type ProjectLockLease,
  type RenewProjectLock,
  type RenewProjectLockOptions,
} from './shared.js';
import type { FallbackRecord } from './fallbackLock.js';

let loadJson = loadJSON;
let saveJson = saveJSON;

export const __setRenewAdapters = (overrides: {
  loadJSON?: typeof loadJSON;
  saveJSON?: typeof saveJSON;
}): void => {
  if (overrides.loadJSON) loadJson = overrides.loadJSON;
  if (overrides.saveJSON) saveJson = overrides.saveJSON;
};

export const __resetRenewAdapters = (): void => {
  loadJson = loadJSON;
  saveJson = saveJSON;
};

export const renewProjectLock: RenewProjectLock = async (lease, options: RenewProjectLockOptions = {}) => {
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
      const record = (await loadJson(FALLBACK_LOCK_PATH)) as FallbackRecord | null;
      if (!record || record.leaseId !== lease.leaseId)
        throw makeError('lease-stale', 'Fallback lease missing for renew', 'renew', false);
      await saveJson(FALLBACK_LOCK_PATH, {
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
    if (!projectError.retryable) emitReadonly('renew-failed', projectError, options.onReadonly);
    throw projectError;
  }
};
