import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  acquireProjectLock,
  projectLockEvents,
  FALLBACK_LOCK_PATH,
  ProjectLockError,
  type ProjectLockEvent,
} from '../../../src/lib/locks';
import { __setAcquireAdapters, __resetAcquireAdapters } from '../../../src/lib/locks/acquire.js';

const createFallbackLease = (ctx: { leaseId: string; ownerId: string; heartbeatMs: number }) => {
  const now = Date.now();
  return {
    leaseId: ctx.leaseId,
    ownerId: ctx.ownerId,
    strategy: 'file-lock' as const,
    viaFallback: true,
    resource: FALLBACK_LOCK_PATH,
    acquiredAt: now,
    expiresAt: now + 2_000,
    ttlMillis: 2_000,
    heartbeatIntervalMs: ctx.heartbeatMs,
    nextHeartbeatAt: now + ctx.heartbeatMs,
    renewAttempt: 0,
  };
};

const createWebLease = (ctx: { leaseId: string; ownerId: string; heartbeatMs: number }) => {
  const now = Date.now();
  return {
    leaseId: ctx.leaseId,
    ownerId: ctx.ownerId,
    strategy: 'web-lock' as const,
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

type AcquireFallback = (ctx: { leaseId: string; ownerId: string; heartbeatMs: number }) => Promise<ReturnType<typeof createFallbackLease>>;

const fallbackState: {
  acquire: AcquireFallback;
  readSnapshot: (() => ReturnType<typeof createFallbackLease> | undefined) | undefined;
} = {
  acquire: async () => {
    throw new Error('fallback acquire behavior not configured');
  },
  readSnapshot: undefined,
};

const webState: {
  acquire: (ctx: { leaseId: string; ownerId: string; heartbeatMs: number }) => ReturnType<typeof createWebLease> | Promise<ReturnType<typeof createWebLease>>;
} = {
  acquire: () => {
    throw new Error('web acquire behavior not configured');
  },
};

const recordEvents = (): { events: ProjectLockEvent[]; unsubscribe: () => void } => {
  const events: ProjectLockEvent[] = [];
  const unsubscribe = projectLockEvents.subscribe((event) => {
    events.push(event);
  });
  return { events, unsubscribe };
};

describe('acquireProjectLock retryable classification', () => {
  test('Web Lock 経由で lease を取得し lock:acquired が web-lock で記録される', async (t) => {
    const { events, unsubscribe } = recordEvents();
    fallbackState.acquire = async () => {
      assert.fail('fallback should not execute when web lock succeeds');
      return createFallbackLease({ leaseId: '', ownerId: '', heartbeatMs: 0 });
    };
    webState.acquire = (ctx) => createWebLease(ctx);
    __setAcquireAdapters({
      acquireViaFallback: async (ctx) => fallbackState.acquire(ctx),
      readFallbackLeaseSnapshot: async () => fallbackState.readSnapshot?.(),
      acquireViaWebLock: async (ctx) => webState.acquire(ctx),
    });
    t.after(() => {
      __resetAcquireAdapters();
    });

    const lease = await acquireProjectLock({ preferredStrategy: 'web-lock', ttlMs: 1_000, heartbeatIntervalMs: 250 });
    unsubscribe();

    assert.equal(lease.strategy, 'web-lock');
    const acquired = events.find((event) => event.type === 'lock:acquired');
    assert.ok(acquired, 'lock:acquired event should fire');
    assert.equal(acquired.lease.strategy, 'web-lock');
    assert.equal(events.filter((event) => event.type === 'lock:attempt' && event.strategy === 'web-lock').length, 1);
  });

  test('navigator.locks 未対応でフォールバックへ移行し lock:fallback-engaged が記録される', async (t) => {
    const { events, unsubscribe } = recordEvents();
    webState.acquire = () => {
      throw new ProjectLockError('web-lock-unsupported', 'mock web lock unsupported', {
        operation: 'acquire',
        retryable: true,
      });
    };
    fallbackState.acquire = async (ctx) => createFallbackLease(ctx);
    fallbackState.readSnapshot = () => undefined;
    __setAcquireAdapters({
      acquireViaFallback: async (ctx) => fallbackState.acquire(ctx),
      readFallbackLeaseSnapshot: async () => fallbackState.readSnapshot?.(),
      acquireViaWebLock: async (ctx) => webState.acquire(ctx),
    });
    t.after(() => {
      __resetAcquireAdapters();
    });

    const lease = await acquireProjectLock({ preferredStrategy: 'web-lock', ttlMs: 2_000, heartbeatIntervalMs: 500 });
    unsubscribe();

    assert.equal(lease.strategy, 'file-lock');
    const fallbackEvents = events.filter((event) => event.type === 'lock:fallback-engaged');
    assert.equal(fallbackEvents.length, 1, 'lock:fallback-engaged should fire once');
    const acquired = events.find((event) => event.type === 'lock:acquired');
    assert.ok(acquired, 'lock:acquired event should fire');
    assert.equal(acquired.lease.strategy, 'file-lock');
  });
});
