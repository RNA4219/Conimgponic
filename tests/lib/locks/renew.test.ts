import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  renewProjectLock,
  projectLockEvents,
  FALLBACK_LOCK_PATH,
  LOCK_HEARTBEAT_INTERVAL_MS,
  FALLBACK_LOCK_TTL_MS,
  ProjectLockError,
  type ProjectLockLease,
  type ProjectLockEvent,
} from '../../../src/lib/locks';
import { __setRenewAdapters, __resetRenewAdapters } from '../../../src/lib/locks/renew.js';

const opfsState = {
  loadJSON: async (_path: string) => null as unknown,
  saveJSON: async (_path: string, _data: unknown) => {},
};

type FallbackRecord = {
  leaseId: string;
  ownerId: string;
  acquiredAt: number;
  expiresAt: number;
  ttlSeconds: number;
  mtime: number;
  heartbeatIntervalMs?: number;
  nextHeartbeatAt?: number;
};

const createFallbackLease = (): ProjectLockLease => ({
  leaseId: 'lease-file',
  ownerId: 'owner-file',
  strategy: 'file-lock',
  viaFallback: true,
  resource: FALLBACK_LOCK_PATH,
  acquiredAt: 0,
  expiresAt: FALLBACK_LOCK_TTL_MS,
  ttlMillis: FALLBACK_LOCK_TTL_MS,
  heartbeatIntervalMs: LOCK_HEARTBEAT_INTERVAL_MS,
  nextHeartbeatAt: LOCK_HEARTBEAT_INTERVAL_MS,
  renewAttempt: 0,
});

const createWebLease = (): ProjectLockLease => ({
  leaseId: 'lease-web',
  ownerId: 'owner-web',
  strategy: 'web-lock',
  viaFallback: false,
  resource: 'navigator.locks',
  acquiredAt: 0,
  expiresAt: FALLBACK_LOCK_TTL_MS,
  ttlMillis: FALLBACK_LOCK_TTL_MS,
  heartbeatIntervalMs: LOCK_HEARTBEAT_INTERVAL_MS,
  nextHeartbeatAt: LOCK_HEARTBEAT_INTERVAL_MS,
  renewAttempt: 1,
});

const collectEvents = (): { events: ProjectLockEvent[]; unsubscribe: () => void } => {
  const events: ProjectLockEvent[] = [];
  const unsubscribe = projectLockEvents.subscribe((event) => events.push(event));
  return { events, unsubscribe };
};

describe('renewProjectLock (file-lock)', () => {
  test('フォールバック lease を更新し OPFS レコードを再書き込みする', async (t) => {
    t.mock.timers.enable({ now: 1_000, apis: ['Date', 'setTimeout'] });
    const lease = createFallbackLease();
    const record: FallbackRecord = {
      leaseId: lease.leaseId,
      ownerId: lease.ownerId,
      acquiredAt: lease.acquiredAt,
      expiresAt: lease.expiresAt,
      ttlSeconds: lease.ttlMillis / 1000,
      mtime: lease.acquiredAt,
      heartbeatIntervalMs: lease.heartbeatIntervalMs,
      nextHeartbeatAt: lease.nextHeartbeatAt,
    };
    const { events, unsubscribe } = collectEvents();
    let savedRecord: FallbackRecord | undefined;

    opfsState.loadJSON = async () => record;
    opfsState.saveJSON = async (_path, data: unknown) => {
      savedRecord = data as FallbackRecord;
    };
    __setRenewAdapters({
      loadJSON: async (path) => opfsState.loadJSON(path),
      saveJSON: async (path, data) => opfsState.saveJSON(path, data),
    });
    t.after(() => {
      __resetRenewAdapters();
    });

    const refreshed = await renewProjectLock(lease);
    unsubscribe();

    assert.ok(savedRecord, 'fallback record should be persisted');
    assert.equal(savedRecord?.leaseId, lease.leaseId);
    assert.ok(savedRecord!.expiresAt > lease.expiresAt);
    assert.equal(refreshed.leaseId, lease.leaseId);
    assert.equal(refreshed.strategy, 'file-lock');
    assert.equal(refreshed.renewAttempt, lease.renewAttempt + 1);
    assert.ok(
      events.some((event) => event.type === 'lock:renewed' && event.lease.leaseId === lease.leaseId),
      'lock:renewed event should fire for the fallback lease'
    );
  });
});

describe('renewProjectLock (web-lock)', () => {
  test('Web Lock lease の更新で fallback I/O を呼び出さない', async (t) => {
    const lease = createWebLease();
    const { events, unsubscribe } = collectEvents();

    opfsState.loadJSON = async () => {
      assert.fail('loadJSON must not be called for web-lock renewals');
      return null;
    };
    opfsState.saveJSON = async () => {
      assert.fail('saveJSON must not be called for web-lock renewals');
    };
    __setRenewAdapters({
      loadJSON: async (path) => opfsState.loadJSON(path),
      saveJSON: async (path, data) => opfsState.saveJSON(path, data),
    });
    t.after(() => {
      __resetRenewAdapters();
    });

    const refreshed = await renewProjectLock(lease);
    unsubscribe();

    assert.equal(refreshed.strategy, 'web-lock');
    assert.equal(refreshed.renewAttempt, lease.renewAttempt + 1);
    assert.ok(events.some((event) => event.type === 'lock:renewed' && event.lease.strategy === 'web-lock'));
  });
});

describe('renewProjectLock (failure handling)', () => {
  test('非リトライエラーで readonly コールバックを呼び出す', async (t) => {
    const lease = createFallbackLease();
    const readonlyNotifications: ProjectLockError[] = [];

    opfsState.loadJSON = async () => null;
    opfsState.saveJSON = async () => {
      assert.fail('saveJSON must not be invoked when lease is missing');
    };

    __setRenewAdapters({
      loadJSON: async (path) => opfsState.loadJSON(path),
      saveJSON: async (path, data) => opfsState.saveJSON(path, data),
    });
    t.after(() => {
      __resetRenewAdapters();
    });

    await assert.rejects(
      () =>
        renewProjectLock(lease, {
          onReadonly: (projectError) => {
            readonlyNotifications.push(projectError);
          },
        }),
      ProjectLockError
    );

    assert.equal(readonlyNotifications.length, 1);
    const projectError = readonlyNotifications[0];
    assert.ok(projectError instanceof ProjectLockError);
    assert.equal(projectError.code, 'lease-stale');
  });
});
