import {
  HEARTBEAT_LEAD_MS,
  ProjectLockError,
  emitError,
  emitReadonly,
  hasErrorEventBeenEmitted,
  projectLockEvents,
  reasonFromOperation,
  type ProjectLockApi,
  type ProjectLockLease,
  type WithProjectLock,
  type WithProjectLockOptions,
} from './shared.js';
import { acquireProjectLock } from './acquire.js';
import { renewProjectLock } from './renew.js';
import { releaseProjectLock, safeRelease } from './release.js';

const withProjectLock: WithProjectLock = async (executor, options = {}) => {
  let lease = await acquireProjectLock(options);
  let activeLease = lease;
  const releaseOnError = options.releaseOnError !== false;
  let renewTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingRenew: Promise<void> | undefined;
  let stopped = false;
  let rejectRenewal: ((reason: unknown) => void) | undefined;
  const renewalFailure = new Promise<never>((_, reject) => {
    rejectRenewal = reject;
  });
  const renewalSignal = renewalFailure.catch((error) => {
    throw error;
  });

  const clearRenewTimer = () => {
    if (renewTimer) {
      clearTimeout(renewTimer);
      renewTimer = undefined;
    }
  };

  const computeRenewInterval = (current: ProjectLockLease) =>
    options.renewIntervalMs ?? Math.max(0, current.ttlMillis - HEARTBEAT_LEAD_MS);

  const scheduleRenewal = () => {
    if (stopped) return;
    clearRenewTimer();
    const interval = computeRenewInterval(activeLease);
    const nextHeartbeatInMs = Math.max(0, interval);
    if (options.renewIntervalMs !== undefined) {
      const scheduledLease: ProjectLockLease = {
        ...activeLease,
        heartbeatIntervalMs: nextHeartbeatInMs,
        nextHeartbeatAt: Date.now() + nextHeartbeatInMs,
      };
      activeLease = scheduledLease;
      lease = scheduledLease;
      projectLockEvents.emit({
        type: 'lock:renew-scheduled',
        lease: scheduledLease,
        nextHeartbeatInMs,
      });
    }
    renewTimer = setTimeout(() => {
      if (stopped) return;
      pendingRenew = renewProjectLock(activeLease, { signal: options.signal })
        .then((refreshed) => {
          activeLease = refreshed;
          lease = refreshed;
          pendingRenew = undefined;
          if (!stopped) scheduleRenewal();
        })
        .catch((error) => {
          pendingRenew = undefined;
          stopped = true;
          clearRenewTimer();
          rejectRenewal?.(error);
          throw error;
        });
    }, interval);
  };

  const stopRenewal = async () => {
    stopped = true;
    clearRenewTimer();
    if (!pendingRenew) return;
    try {
      await pendingRenew;
    } finally {
      pendingRenew = undefined;
    }
  };

  scheduleRenewal();

  const finalize = async (result: unknown) => {
    await stopRenewal();
    await safeRelease(lease, { signal: options.signal, onReadonly: options.onReadonly }, false);
    return result;
  };

  try {
    const outcome = await Promise.race([executor(lease), renewalSignal]);
    return (await finalize(outcome)) as Awaited<typeof outcome>;
  } catch (error) {
    let failure: unknown = error;
    let readonlyEmitted = false;
    const notifyErrorOnce = (projectError: ProjectLockError) => {
      if (!hasErrorEventBeenEmitted(projectError)) {
        emitError(projectError);
      }
    };
    if (error instanceof ProjectLockError) {
      notifyErrorOnce(error);
      if (!error.retryable) {
        emitReadonly(reasonFromOperation(error.operation), error, options.onReadonly);
        readonlyEmitted = true;
      }
    }

    if (
      failure instanceof ProjectLockError &&
      (!(error instanceof ProjectLockError) || failure !== error)
    ) {
      notifyErrorOnce(failure);
      if (!failure.retryable && !readonlyEmitted)
        emitReadonly(reasonFromOperation(failure.operation), failure, options.onReadonly);
    }

    if (!releaseOnError) throw failure;

    try {
      await stopRenewal();
    } catch (renewalError) {
      failure = renewalError;
    }

    try {
      await safeRelease(lease, { signal: options.signal, onReadonly: options.onReadonly }, false);
    } catch (releaseError) {
      failure = releaseError;
    }

    throw failure;
  } finally {
    stopped = true;
    clearRenewTimer();
    pendingRenew = undefined;
  }
};

export const projectLockApi: ProjectLockApi = Object.freeze({
  events: projectLockEvents,
  acquire: acquireProjectLock,
  renew: renewProjectLock,
  release: releaseProjectLock,
  withProjectLock,
});

export { acquireProjectLock } from './acquire.js';
export { renewProjectLock } from './renew.js';
export { releaseProjectLock } from './release.js';
export { projectLockEvents } from './shared.js';
export type {
  AcquireProjectLockOptions,
  AcquireProjectLock,
  BackoffPolicy,
  FallbackLockLeaseRecord,
  LockAcquisitionStrategy,
  ProjectLockApi,
  ProjectLockErrorCode,
  ProjectLockEvent,
  ProjectLockEventListener,
  ProjectLockEventTarget,
  ProjectLockLease,
  ProjectLockOperation,
  ProjectLockReadonlyReason,
  ProjectLockStateTransition,
  ProjectLockWarningKind,
  ReleaseProjectLock,
  ReleaseProjectLockOptions,
  RenewProjectLock,
  RenewProjectLockOptions,
  WithProjectLock,
  WithProjectLockOptions,
} from './shared.js';
export {
  WEB_LOCK_KEY,
  WEB_LOCK_TTL_MS,
  FALLBACK_LOCK_PATH,
  FALLBACK_LOCK_TTL_MS,
  LOCK_HEARTBEAT_INTERVAL_MS,
  MAX_LOCK_RETRIES,
  PROJECT_LOCK_STATE_MACHINE,
  FALLBACK_LOCK_LEASE_SCHEMA,
  PROJECT_LOCK_TEST_CASES,
  ProjectLockError,
} from './shared.js';

export { withProjectLock };
