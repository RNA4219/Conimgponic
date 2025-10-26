/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bootstrapPluginBridge,
  type PluginBridgeBackingState,
  type PluginCollector,
  type PluginCollectorEvent,
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

const expectFlagTelemetry = (
  events: readonly PluginCollectorEvent[],
  config: {
    readonly origin: string;
    readonly phase: string;
    readonly evaluationMs: number;
    readonly flags: ReadonlyArray<readonly [string, unknown]>;
  }
): void => {
  const telemetry = events.filter(
    (message): message is Record<string, unknown> =>
      !!message &&
      typeof message === 'object' &&
      (message as Record<string, unknown>).kind === 'telemetry'
  );
  assert.equal(telemetry.length, config.flags.length);

  const actual = telemetry
    .map((entry) => {
      assert.equal(entry.feature, 'config.flags');
      assert.equal(entry.event, 'flag_resolution');
      assert.equal(entry.source, config.origin);
      assert.equal(entry.phase, config.phase);

      const evaluationMs = entry.evaluation_ms;
      assert.equal(typeof evaluationMs, 'number');
      assert.ok(Number.isFinite(evaluationMs));
      assert.equal(evaluationMs, config.evaluationMs);

      return [String(entry.flag), entry.variant] as const;
    })
    .sort((a, b) => a[0].localeCompare(b[0]));

  const expected = config.flags
    .map(([flag, variant]) => [flag, variant] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));

  assert.deepEqual(actual, expected);
};

const DEFAULT_FLAG_VARIANTS: ReadonlyArray<readonly [string, unknown]> = [
  ['autosave.enabled', false] as const,
  ['plugins.enable', false] as const,
  ['merge.precision', 'legacy'] as const,
];

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
  expectFlagTelemetry(published, {
    origin: 'vscode.plugins',
    phase: 'bootstrap',
    evaluationMs: 44,
    flags: DEFAULT_FLAG_VARIANTS,
  });

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
  expectFlagTelemetry(published, {
    origin: 'vscode.plugins',
    phase: 'bootstrap',
    evaluationMs: 92,
    flags: DEFAULT_FLAG_VARIANTS,
  });

  restorePerformance();
});
