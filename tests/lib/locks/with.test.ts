import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  withProjectLock,
  projectLockEvents,
  FALLBACK_LOCK_PATH,
  type ProjectLockEvent,
  type ProjectLockLease,
  ProjectLockError,
} from '../../../src/lib/locks';
import { __setAcquireAdapters, __resetAcquireAdapters } from '../../../src/lib/locks/acquire.js';
import { __setReleaseAdapters, __resetReleaseAdapters } from '../../../src/lib/locks/release.js';

const fallbackState = {
  acquire: (ctx: { leaseId: string; ownerId: string; heartbeatMs: number }) => createFallbackLease(ctx),
  release: async (_lease: unknown, _force?: boolean) => {},
};

const webState = {
  acquire: (ctx: { leaseId: string; ownerId: string; heartbeatMs: number }) => createWebLease(ctx),
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

const createFallbackLease = (ctx: { leaseId: string; ownerId: string; heartbeatMs: number }): ProjectLockLease => {
  const now = Date.now();
  return {
    leaseId: ctx.leaseId,
    ownerId: ctx.ownerId,
    strategy: 'file-lock',
    viaFallback: true,
    resource: FALLBACK_LOCK_PATH,
    acquiredAt: now,
    expiresAt: now + 1_000,
    ttlMillis: 1_000,
    heartbeatIntervalMs: ctx.heartbeatMs,
    nextHeartbeatAt: now + ctx.heartbeatMs,
    renewAttempt: 0,
  };
};

const createWebLease = (ctx: { leaseId: string; ownerId: string; heartbeatMs: number }): ProjectLockLease => {
  const now = Date.now();
  return {
    leaseId: ctx.leaseId,
    ownerId: ctx.ownerId,
    strategy: 'web-lock',
    viaFallback: false,
    resource: 'navigator.locks',
    acquiredAt: now,
    expiresAt: now + 1_000,
    ttlMillis: 1_000,
    heartbeatIntervalMs: ctx.heartbeatMs,
    nextHeartbeatAt: now + ctx.heartbeatMs,
    renewAttempt: 0,
  };
};

describe('withProjectLock', () => {
  test('フォールバック lease を用いた実行で releaseFallbackLease が呼ばれる', async (t) => {
    const { events, unsubscribe } = collectEvents();
    let releaseCalls = 0;
    fallbackState.release = async () => {
      releaseCalls += 1;
    };
    webState.acquire = () => {
      throw new ProjectLockError('web-lock-unsupported', 'mock web locks unsupported', {
        operation: 'acquire',
        retryable: true,
      });
    };
    fallbackState.acquire = (ctx) => createFallbackLease(ctx);
    __setAcquireAdapters({
      acquireViaFallback: async (ctx) => fallbackState.acquire(ctx),
      readFallbackLeaseSnapshot: async () => undefined,
      acquireViaWebLock: async (ctx) => webState.acquire(ctx),
    });
    __setReleaseAdapters({
      releaseFallbackLease: async (lease, force) => fallbackState.release(lease, force),
      getWebLockHandle: (leaseId) => webState.handle(leaseId),
      clearWebLockHandle: (leaseId) => webState.clear(leaseId),
    });
    t.after(() => {
      __resetAcquireAdapters();
      __resetReleaseAdapters();
    });

    const result = await withProjectLock(async (lease) => {
      assert.equal(lease.strategy, 'file-lock');
      return 'fallback-ok';
    }, { preferredStrategy: 'web-lock', ttlMs: 1_000, heartbeatIntervalMs: 250 });
    unsubscribe();

    assert.equal(result, 'fallback-ok');
    assert.equal(releaseCalls, 1);
    assert.ok(events.some((event) => event.type === 'lock:acquired' && event.lease.strategy === 'file-lock'));
    assert.ok(events.some((event) => event.type === 'lock:released'));
  });

  test('Web Lock lease でも executor 完了後に release が実行される', async (t) => {
    const { events, unsubscribe } = collectEvents();
    let releaseCalls = 0;
    fallbackState.acquire = async () => {
      assert.fail('fallback acquisition must not run for web-lock scenario');
      return createFallbackLease({ leaseId: '', ownerId: '', heartbeatMs: 0 });
    };
    webState.acquire = (ctx) => createWebLease(ctx);
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
    __setAcquireAdapters({
      acquireViaFallback: async (ctx) => fallbackState.acquire(ctx),
      readFallbackLeaseSnapshot: async () => undefined,
      acquireViaWebLock: async (ctx) => webState.acquire(ctx),
    });
    __setReleaseAdapters({
      releaseFallbackLease: async (lease, force) => fallbackState.release(lease, force),
      getWebLockHandle: (leaseId) => webState.handle(leaseId),
      clearWebLockHandle: (leaseId) => webState.clear(leaseId),
    });
    t.after(() => {
      __resetAcquireAdapters();
      __resetReleaseAdapters();
    });

    const result = await withProjectLock(async (lease) => {
      assert.equal(lease.strategy, 'web-lock');
      return 'web-ok';
    }, { preferredStrategy: 'web-lock', ttlMs: 1_000, heartbeatIntervalMs: 250 });
    unsubscribe();

    assert.equal(result, 'web-ok');
    assert.equal(releaseCalls, 1);
    assert.equal(clearCalls, 1);
    assert.ok(events.some((event) => event.type === 'lock:acquired' && event.lease.strategy === 'web-lock'));
    assert.ok(events.some((event) => event.type === 'lock:released'));
  });
});
