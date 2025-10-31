/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAtomicWriteError } from '../../../../src/platform/vscode/autosave/error.js';
import {
  createSnapshotFailureDetail,
  createSnapshotSuccessDetail,
  encodeGuardTelemetry,
  publishCollectorSnapshotResult
} from '../../../../src/platform/vscode/autosave/collector.js';
import {
  createInitialState,
  nextCorrelationId,
  nextReqId
} from '../../../../src/platform/vscode/autosave/state.js';
import { createVscodeAutoSaveBridge } from '../../../../src/platform/vscode/autosave.js';

class TestDomException extends Error {
  override name = 'NotAllowedError';
}

test('normalizeAtomicWriteError maps DOMException with retry flag', () => {
  const dom = new TestDomException('nope');
  // Simulate global DOMException support in browsers.
  // @ts-expect-error intentional test shim
  globalThis.DOMException = TestDomException;

  try {
    const normalized = normalizeAtomicWriteError(dom);
    assert.equal(normalized.code, 'write-failed');
    assert.equal(normalized.retryable, false);
    assert.equal(normalized.context?.kind, 'dom-exception');
    assert.equal(normalized.context?.name, 'NotAllowedError');
  } finally {
    // @ts-expect-error intentional cleanup of test shim
    delete globalThis.DOMException;
  }
});

test('createSnapshotFailureDetail normalizes message and code', () => {
  const detail = createSnapshotFailureDetail(
    412.4,
    3,
    true,
    '  write-failed  ',
    '   ',
    12.9,
    'error'
  );
  assert.equal(detail.retryable, true);
  assert.equal(detail.error_code, 'write-failed');
  assert.equal(detail.error_message, 'write-failed');
  assert.equal(detail.lag_seconds, 12);
});

test('publishCollectorSnapshotResult forwards normalized payload', () => {
  const calls: unknown[] = [];
  const request = {
    reqId: 'req-1',
    correlationId: 'corr-1',
    payload: { debounceMs: 1 }
  } as const;
  const guard = {
    featureFlag: { value: true, source: 'env' },
    optionsDisabled: false
  } as const;
  const payload = {
    status: 'success' as const,
    detail: createSnapshotSuccessDetail(120, 0, undefined, 'idle'),
    snapshot: {
      bytes: 4,
      retained_bytes: 4,
      generation: 1,
      last_success_at: '2024-01-01T00:00:00.000Z'
    }
  };
  const timestamp = '2024-01-01T00:00:00.000Z';

  publishCollectorSnapshotResult(request, guard, timestamp, payload, {
    publishSnapshotResult: (event) => {
      calls.push(event);
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(
    (calls[0] as { overrides: { ts: string } }).overrides.ts,
    timestamp
  );
});

test('publishCollectorSnapshotResult flags localStorage guard as QA phase', () => {
  const calls: unknown[] = [];
  const request = {
    reqId: 'req-1',
    correlationId: 'corr-1',
    payload: { debounceMs: 1 }
  } as const;
  const guard = {
    featureFlag: { value: true, source: 'localStorage' as const },
    optionsDisabled: false
  };
  const payload = {
    status: 'success' as const,
    detail: createSnapshotSuccessDetail(120, 0, undefined, 'idle'),
    snapshot: {
      bytes: 4,
      retained_bytes: 4,
      generation: 1,
      last_success_at: '2024-01-01T00:00:00.000Z'
    }
  };
  const timestamp = '2024-01-01T00:00:00.000Z';

  publishCollectorSnapshotResult(request, guard, timestamp, payload, {
    publishSnapshotResult: (event) => {
      calls.push(event);
    }
  });

  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { phase: string }).phase, 'A-1');
});

test('encodeGuardTelemetry marks localStorage guard as QA phase', () => {
  const guard = {
    featureFlag: { value: true, source: 'localStorage' as const },
    optionsDisabled: false
  };

  const telemetry = encodeGuardTelemetry(guard);

  assert.deepEqual(telemetry, { current: 'A-1', rollbackTo: 'A-0' });
});

test('createInitialState assigns counters and identifiers deterministically', () => {
  const state = createInitialState({
    featureFlag: { value: false, source: 'env' },
    optionsDisabled: false
  });
  assert.equal(state.status, 'disabled');
  assert.equal(nextReqId(state), 'autosave-1');
  assert.equal(nextCorrelationId(state), 'autosave-corr-1');
});

test('reportDirty keeps autosave disabled when guard disabled', async () => {
  const now = new Date('2024-01-01T00:00:00.000Z');
  const sent: unknown[] = [];
  const bridge = createVscodeAutoSaveBridge({
    initialGuard: {
      featureFlag: { value: false, source: 'env' },
      optionsDisabled: false
    },
    policy: {
      debounceMs: 100,
      idleMs: 100,
      maxGenerations: 2,
      maxBytes: 100,
      disabled: false
    },
    flags: undefined,
    workspace: null,
    now: () => now,
    sendMessage: (message) => {
      sent.push(message);
    },
    atomicWrite: async () => ({
      ok: true,
      bytes: 1,
      retainedBytes: 1,
      generation: 1,
      lockStrategy: 'web-lock'
    })
  });

  // Consume bootstrap message
  assert.ok(sent[0]);
  sent.length = 0;

  bridge.reportDirty(10, {
    featureFlag: { value: false, source: 'env' },
    optionsDisabled: false
  });

  assert.equal(sent.length, 1);
  const status = sent[0] as { payload: { state: string } };
  assert.equal(status.payload.state, 'disabled');
});
