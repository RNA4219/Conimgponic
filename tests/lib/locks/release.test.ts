import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  releaseProjectLock,
  projectLockEvents,
  FALLBACK_LOCK_PATH,
  type ProjectLockLease,
  type ProjectLockEvent,
} from '../../../src/lib/locks';
import { __setReleaseAdapters, __resetReleaseAdapters } from '../../../src/lib/locks/release.js';

const fallbackState = {
  release: async (_lease: unknown, _force?: boolean) => {},
};

const webState = {
  handle: (_leaseId: string) => ({
    release: async () => {},
    getReleaseError: () => undefined,
  }),
  clear: (_leaseId: string) => {},
};

const collectEvents = (): { events: ProjectLockEvent[]; unsubscribe: () => void } => {
  const events: ProjectLockEvent[] = [];
  const unsubscribe = projectLockEvents.subscribe((event) => events.push(event));
  return { events, unsubscribe };
};

const createFallbackLease = (): ProjectLockLease => ({
  leaseId: 'fallback-release',
  ownerId: 'owner',
  strategy: 'file-lock',
  viaFallback: true,
  resource: FALLBACK_LOCK_PATH,
  acquiredAt: 0,
  expiresAt: 10_000,
  ttlMillis: 10_000,
  heartbeatIntervalMs: 1_000,
  nextHeartbeatAt: 1_000,
  renewAttempt: 0,
});

const createWebLease = (): ProjectLockLease => ({
  leaseId: 'web-release',
  ownerId: 'owner',
  strategy: 'web-lock',
  viaFallback: false,
  resource: 'navigator.locks',
  acquiredAt: 0,
  expiresAt: 10_000,
  ttlMillis: 10_000,
  heartbeatIntervalMs: 1_000,
  nextHeartbeatAt: 1_000,
  renewAttempt: 0,
});

describe('releaseProjectLock', () => {
  test('フォールバック lease の解放で releaseFallbackLease が 1 回呼び出される', async (t) => {
    const lease = createFallbackLease();
    const { events, unsubscribe } = collectEvents();
    let releaseCount = 0;
    fallbackState.release = async () => {
      releaseCount += 1;
    };
    __setReleaseAdapters({
      releaseFallbackLease: async (l, force) => fallbackState.release(l, force),
      getWebLockHandle: (leaseId) => webState.handle(leaseId),
      clearWebLockHandle: (leaseId) => webState.clear(leaseId),
    });
    t.after(() => {
      __resetReleaseAdapters();
    });

    await releaseProjectLock(lease);
    unsubscribe();

    assert.equal(releaseCount, 1);
    assert.ok(events.some((event) => event.type === 'lock:released' && event.leaseId === lease.leaseId));
  });

  test('Web Lock lease 解放で handle.release が呼び出され lock:released が通知される', async (t) => {
    const lease = createWebLease();
    const { events, unsubscribe } = collectEvents();
    let releaseCalls = 0;
    webState.handle = () => ({
      release: async () => {
        releaseCalls += 1;
      },
      getReleaseError: () => undefined,
    });
    let clearCalls = 0;
    webState.clear = () => {
      clearCalls += 1;
    };
    __setReleaseAdapters({
      releaseFallbackLease: async (l, force) => fallbackState.release(l, force),
      getWebLockHandle: (leaseId) => webState.handle(leaseId),
      clearWebLockHandle: (leaseId) => webState.clear(leaseId),
    });
    t.after(() => {
      __resetReleaseAdapters();
    });

    await releaseProjectLock(lease);
    unsubscribe();

    assert.equal(releaseCalls, 1);
    assert.equal(clearCalls, 1);
    assert.ok(events.some((event) => event.type === 'lock:released' && event.leaseId === lease.leaseId));
  });
});
