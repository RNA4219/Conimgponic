/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FEATURE_FLAG_DEFINITIONS,
  resolveFlags,
  type FlagSnapshot,
  type FlagValidationError,
  type ResolveOptions,
} from '../../../src/config/index.js';

import {
  bootstrapPluginBridge,
  normalizePluginManifest,
  type PluginBridgeBackingState,
  type PluginCollector,
  type PluginCollectorEvent,
  type PluginManifest,
  type PluginPhaseGuard,
} from '../../../src/platform/vscode/plugins/index.js';

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

type FlagExpectation = {
  readonly flag: string;
  readonly variant: string;
  readonly source: string;
  readonly phase: string;
  readonly errors: readonly FlagValidationError[];
};

const sortErrors = (
  errors: readonly FlagValidationError[]
): readonly FlagValidationError[] =>
  [...errors].sort((a, b) => a.code.localeCompare(b.code));

const expectFlagTelemetry = (
  events: readonly PluginCollectorEvent[],
  config: {
    readonly origin: string;
    readonly phase: string;
    readonly evaluationMs: number;
    readonly flags: readonly FlagExpectation[];
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

      assert.ok(!('snapshot' in entry));
      assert.ok(!('errors' in entry));

      const payload = (entry as { payload?: Record<string, unknown> }).payload;
      assert.ok(payload && typeof payload === 'object', 'flag_resolution payload must exist');

      const flag = String(payload.flag);
      const variant = String(payload.variant);
      const source = String(payload.source);
      const phase = String(payload.phase);
      const payloadEvaluation = payload.evaluation_ms;
      assert.equal(payloadEvaluation, config.evaluationMs);

      const payloadErrors = Array.isArray(payload.errors)
        ? (payload.errors as FlagValidationError[])
        : [];

      return {
        flag,
        variant,
        source,
        phase,
        errors: sortErrors(payloadErrors),
      };
    })
    .sort((a, b) => a.flag.localeCompare(b.flag));

  const expected = config.flags
    .map((flag) => ({
      flag: flag.flag,
      variant: flag.variant,
      source: flag.source,
      phase: flag.phase,
      errors: sortErrors(flag.errors),
    }))
    .sort((a, b) => a.flag.localeCompare(b.flag));

  assert.deepEqual(actual, expected);
};

const snapshotFlags = (snapshot: FlagSnapshot): readonly FlagExpectation[] => [
  {
    flag: 'autosave.enabled',
    variant: String(snapshot.autosave.value),
    source: snapshot.autosave.source,
    phase: FEATURE_FLAG_DEFINITIONS['autosave.enabled'].phase,
    errors: snapshot.autosave.errors,
  },
  {
    flag: 'plugins.enable',
    variant: String(snapshot.plugins.value),
    source: snapshot.plugins.source,
    phase: FEATURE_FLAG_DEFINITIONS['plugins.enable'].phase,
    errors: snapshot.plugins.errors,
  },
  {
    flag: 'merge.precision',
    variant: String(snapshot.merge.value),
    source: snapshot.merge.source,
    phase: FEATURE_FLAG_DEFINITIONS['merge.precision'].phase,
    errors: snapshot.merge.errors,
  },
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
      assert.ok(
        !key.startsWith('conimg.'),
        'workspace.get は AUTOSAVE-DESIGN-IMPL §3.6 と MERGE-DESIGN-IMPL §5.4 の要件通り接頭辞なしキーのみを受け付ける'
      );
      if (key === 'plugins.enable') {
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
  const { snapshot } = resolveFlags({ workspace }, { withErrors: true });
  expectFlagTelemetry(published, {
    origin: 'vscode.plugins',
    phase: 'bootstrap',
    evaluationMs: 44,
    flags: snapshotFlags(snapshot),
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
  const { snapshot } = resolveFlags(
    {
      env: {
        VITE_PLUGINS_ENABLE: 'invalid-value',
      },
    },
    { withErrors: true }
  );
  expectFlagTelemetry(published, {
    origin: 'vscode.plugins',
    phase: 'bootstrap',
    evaluationMs: 92,
    flags: snapshotFlags(snapshot),
  });

  restorePerformance();
});

test('normalizePluginManifest clones mutable manifest collections', () => {
  const manifest: PluginManifest = {
    id: 'sample.plugin',
    version: '1.2.3',
    engines: { vscode: '1.35.0' },
    'conimg-api': '1',
    permissions: ['fs:read'],
    hooks: ['onCompile'],
  };

  const normalized = normalizePluginManifest(manifest);

  assert.deepEqual(normalized.permissions, manifest.permissions);
  assert.notStrictEqual(normalized.permissions, manifest.permissions);
  assert.deepEqual(normalized.hooks, manifest.hooks);
  assert.notStrictEqual(normalized.hooks, manifest.hooks);

  const defaults = normalizePluginManifest({
    id: manifest.id,
    version: manifest.version,
    engines: manifest.engines,
    'conimg-api': manifest['conimg-api'],
  });

  assert.deepEqual(defaults.permissions, []);
  assert.deepEqual(defaults.hooks, []);
});
