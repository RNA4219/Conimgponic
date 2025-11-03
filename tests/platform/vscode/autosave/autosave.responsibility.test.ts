/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAtomicWriteError } from '../../../../src/platform/vscode/autosave/error.js';
import {
  createBootstrapMessage,
  createSnapshotResultMessage,
  createStatusMessage,
  toIsoTimestamp
} from '../../../../src/platform/vscode/autosave/bootstrap.js';
import { resolveSnapshotTelemetryPhase } from '../../../../src/platform/vscode/autosave/guard.js';
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
import {
  deriveAutoSavePhaseGuard,
  resolveWorkspaceFlags
} from '../../../../src/platform/vscode/flags/index.js';
import { resolveFlags } from '../../../../src/config/index.js';
import type { Day8CollectorFlagResolutionEvent } from '../../../../src/telemetry/day8Collector.js';

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

test('createBootstrapMessage preserves guard snapshot and flags', () => {
  const ts = toIsoTimestamp(() => new Date('2024-01-01T00:00:00.000Z'));
  const message = createBootstrapMessage(
    'req-1',
    'corr-1',
    ts,
    {
      debounceMs: 1,
      idleMs: 1,
      maxGenerations: 1,
      maxBytes: 1,
      disabled: false
    },
    {
      featureFlag: { value: true, source: 'env' },
      optionsDisabled: false
    },
    { auto: { enabled: true } }
  );

  assert.equal(message.type, 'bridge.bootstrap');
  assert.deepEqual(message.payload.guard.featureFlag, {
    value: true,
    source: 'env'
  });
  assert.deepEqual(message.payload.flags, { auto: { enabled: true } });
});

test('resolveSnapshotTelemetryPhase escalates local storage guard phase', () => {
  const guard = {
    featureFlag: { value: true, source: 'localStorage' as const },
    optionsDisabled: false
  };

  const phase = resolveSnapshotTelemetryPhase(guard, 'A-2');

  assert.equal(phase, 'B-0');
});

test('createSnapshotResultMessage keeps request correlation identifiers', () => {
  const message = createSnapshotResultMessage(
    {
      reqId: 'req-2',
      correlationId: 'corr-2',
      payload: { guard: { featureFlag: { value: true, source: 'env' }, optionsDisabled: false } }
    } as AutoSaveSnapshotRequestMessage,
    '2024-01-01T00:00:00.000Z',
    { ok: true, bytes: 1, generation: 1, retainedBytes: 1, lastSuccessAt: '2024-01-01T00:00:00.000Z' }
  );

  assert.equal(message.reqId, 'req-2');
  assert.equal(message.correlationId, 'corr-2');
});

test('createStatusMessage normalizes status phase metadata', () => {
  const message = createStatusMessage(
    'req-3',
    'corr-3',
    '2024-01-01T00:00:01.000Z',
    'A-1',
    'dirty',
    {
      featureFlag: { value: true, source: 'env' },
      optionsDisabled: false
    },
    2,
    '2024-01-01T00:00:00.000Z'
  );

  assert.equal(message.payload.phase, 'debouncing');
  assert.equal(message.payload.retryCount, 2);
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

test('resolveWorkspaceFlags aligns with resolveFlags and bootstrap propagates guard', () => {
  const workspace = {
    get: (key: string) => {
      switch (key) {
        case 'autosave.enabled':
          return 'true';
        case 'plugins.enable':
          return 'false';
        case 'merge.precision':
          return 'stable';
        default:
          return undefined;
      }
    }
  };
  const clock = () => new Date('2024-01-05T00:00:00.000Z');
  const helperSnapshot = resolveWorkspaceFlags({ workspace, clock });
  const directSnapshot = resolveFlags({ workspace, clock });

  assert.deepEqual(helperSnapshot, directSnapshot);

  const helperGuard = deriveAutoSavePhaseGuard(helperSnapshot);
  assert.deepEqual(helperGuard, {
    featureFlag: {
      value: directSnapshot.autosave.enabled,
      source: directSnapshot.autosave.source
    },
    optionsDisabled: !directSnapshot.autosave.enabled
  });

  const sent: unknown[] = [];
  const bridge = createVscodeAutoSaveBridge({
    policy: {
      debounceMs: 100,
      idleMs: 100,
      maxGenerations: 2,
      maxBytes: 100,
      disabled: false
    },
    workspace,
    now: clock,
    sendMessage: (message) => {
      sent.push(message);
    },
    atomicWrite: async () => {
      throw new Error('bootstrap should not flush');
    }
  });

  assert.equal(sent.length, 2);
  const bootstrap = sent[0] as {
    type: string;
    payload: { guard: unknown; flags: unknown };
  };
  assert.equal(bootstrap?.type, 'bridge.bootstrap');
  assert.deepEqual(bootstrap.payload.flags, helperSnapshot);
  assert.deepEqual(bootstrap.payload.guard, helperGuard);

  const state = bridge.inspectState();
  assert.deepEqual(state.guard, helperGuard);
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

test('createVscodeAutoSaveBridge publishes flag resolution telemetry on bootstrap fallback', () => {
  const scope = globalThis as {
    Day8Collector?: { publish: (event: Day8CollectorFlagResolutionEvent) => void }
  };
  const previous = scope.Day8Collector;
  const published: Day8CollectorFlagResolutionEvent[] = [];
  scope.Day8Collector = {
    publish: (event) => {
      published.push(event);
    }
  };

  try {
    const now = new Date('2024-01-01T00:00:00.000Z');
    createVscodeAutoSaveBridge({
      initialGuard: {
        featureFlag: { value: false, source: 'env' },
        optionsDisabled: false
      },
      policy: {
        debounceMs: 100,
        idleMs: 100,
        maxGenerations: 1,
        maxBytes: 1024,
        disabled: false
      },
      flags: undefined,
      workspace: null,
      now: () => now,
      sendMessage: () => {
        // noop
      },
      atomicWrite: async () => ({
        ok: true,
        bytes: 0,
        retainedBytes: 0,
        generation: 0,
        lockStrategy: 'web-lock'
      })
    });

    assert.ok(
      published.some((event) => event.event === 'flag_resolution'),
      'expected Day8Collector flag_resolution event'
    );
  } finally {
    scope.Day8Collector = previous;
    if (!previous) {
      delete scope.Day8Collector;
    }
  }
});

test('encodeGuardTelemetry marks localStorage guard as QA phase', () => {
  const guard = {
    featureFlag: { value: true, source: 'localStorage' as const },
    optionsDisabled: false
  };

  const telemetry = encodeGuardTelemetry(guard);

  assert.deepEqual(telemetry, { current: 'A-1', rollbackTo: 'A-0' });
});

test('encodeGuardTelemetry escalates workspace guard to release phase', () => {
  const guard = {
    featureFlag: { value: true, source: 'workspace' as const },
    optionsDisabled: false
  };

  const telemetry = encodeGuardTelemetry(guard);

  assert.deepEqual(telemetry, { current: 'A-2', rollbackTo: 'A-1' });
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
