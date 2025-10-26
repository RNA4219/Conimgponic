/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bootstrapPluginBridge,
  type PluginBridgeBackingState,
  type PluginCollector,
  type PluginCollectorEvent,
  type PluginCollectorFlagResolutionEvent,
  type PluginPhaseGuard,
} from '../../../src/platform/vscode/plugins/index.js';

import type { ResolveOptions } from '../../../src/config/index.js';

const createState = (): PluginBridgeBackingState => ({
  manifests: new Map(),
  permissions: new Map(),
  dependencies: new Map(),
  hooks: new Set(),
});

const stubPerformance = (values: readonly number[]): (() => void) => {
  const scope = globalThis as typeof globalThis & {
    performance?: { now(): number }
  };
  const original = scope.performance;
  const remaining = [...values];
  scope.performance = {
    now() {
      const next = remaining.shift();
      if (typeof next === 'number') {
        return next;
      }
      return remaining[0] ?? 0;
    },
  } as Performance;
  return () => {
    if (original) {
      scope.performance = original;
    } else {
      delete scope.performance;
    }
  };
};

test('bootstrapPluginBridge skips initialization when plugin flag disabled', () => {
  const published: PluginCollectorEvent[] = [];
  const collector: PluginCollector = {
    publish(message) {
      published.push(message);
    },
  };
  const phaseGuard: PluginPhaseGuard = {
    ensureReloadAllowed(phase) {
      return phase === 'plugins:reload';
    },
  };
  const workspace: ResolveOptions['workspace'] = {
    get(key) {
      if (key === 'conimg.plugins.enable') {
        return false;
      }
      return undefined;
    },
  };

  const restorePerformance = stubPerformance([401, 445]);

  const bridge = bootstrapPluginBridge({
    platformVersion: '1.35.2',
    conimgApiVersion: '1',
    collector,
    phaseGuard,
    state: createState(),
    resolveOptions: { workspace },
  });

  assert.equal(bridge, undefined);
  const telemetry = published.filter(
    (message): message is PluginCollectorFlagResolutionEvent => message.kind === 'telemetry'
  );
  assert.equal(telemetry.length, 1);
  const event = telemetry[0];
  assert.equal(event.event, 'flag_resolution');
  assert.equal(event.snapshot.plugins.enabled, false);
  assert.equal(event.snapshot.plugins.source, 'workspace');
  assert.ok(Array.isArray(event.errors));
  assert.equal(event.errors.length, 0);
  assert.equal(typeof event.evaluation_ms, 'number');
  assert.ok(Number.isFinite(event.evaluation_ms));
  assert.equal(event.evaluation_ms, 44);
  assert.ok(event.evaluation_ms >= 0);

  restorePerformance();
});

test('bootstrapPluginBridge publishes flag resolution telemetry for plan snapshot', () => {
  const published: PluginCollectorEvent[] = [];
  const collector: PluginCollector = {
    publish(message) {
      published.push(message);
    },
  };
  const phaseGuard: PluginPhaseGuard = {
    ensureReloadAllowed(phase) {
      return phase === 'plugins:reload';
    },
  };

  const restorePerformance = stubPerformance([511, 603]);

  const bridge = bootstrapPluginBridge({
    platformVersion: '1.35.2',
    conimgApiVersion: '1',
    collector,
    phaseGuard,
    state: createState(),
    resolveOptions: {
      env: {
        VITE_PLUGINS_ENABLE: 'invalid-value',
      },
    },
  });

  assert.equal(bridge, undefined);
  const telemetry = published.filter(
    (message): message is PluginCollectorFlagResolutionEvent => message.kind === 'telemetry'
  );
  assert.equal(telemetry.length, 1);
  const event = telemetry[0];
  assert.equal(event.event, 'flag_resolution');
  assert.equal(event.feature, 'config.flags');
  assert.equal(event.source, 'vscode.plugins');
  assert.equal(event.phase, 'bootstrap');
  assert.match(event.ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(event.snapshot.plugins);
  assert.equal(event.snapshot.plugins.enabled, false);
  assert.equal(event.snapshot.plugins.source, 'default');
  assert.ok(Array.isArray(event.errors));
  assert.ok(event.errors.length > 0);
  assert.equal(typeof event.evaluation_ms, 'number');
  assert.ok(Number.isFinite(event.evaluation_ms));
  assert.equal(event.evaluation_ms, 92);
  assert.ok(event.evaluation_ms >= 0);

  restorePerformance();
});
