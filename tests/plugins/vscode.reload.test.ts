import test from 'node:test';
import assert from 'node:assert/strict';

import {
  maybeCreatePluginBridge,
  type PluginReloadRequest,
  type PluginBridge,
  type PluginReloadStageName,
  PluginReloadErrorCode,
} from '../../src/platform/vscode/plugins/index.js';

const stageOrder: PluginReloadStageName[] = [
  'manifest-validation',
  'compatibility-check',
  'permission-gate',
  'dependency-cache',
  'hook-registration',
];

function createBridge(): PluginBridge {
  const bridge = maybeCreatePluginBridge({
    enableFlag: true,
    platformVersion: '1.35.2',
    collector: {
      published: [],
      publish(message) {
        this.published.push(message);
      },
    },
    phaseGuard: {
      ensureReloadAllowed(phase) {
        return phase === 'plugins:reload';
      },
    },
    state: {
      manifests: new Map(),
      permissions: new Map(),
      dependencies: new Map(),
      hooks: new Set(),
    },
  });

  assert.ok(bridge, 'bridge should be created when enableFlag=true');
  return bridge;
}

test('reload success updates registry and emits logs', async () => {
  const bridge = createBridge();
  const manifest = {
    id: 'alpha',
    version: '1.0.0',
    minPlatformVersion: '1.34.0',
    permissions: ['fs'],
    dependencies: { 'dep-alpha': '1.0.0' },
    hooks: ['workspace.didOpen'],
  } as const;

  const request: PluginReloadRequest = {
    kind: 'plugins.reload',
    pluginId: 'alpha',
    manifest,
    grantedPermissions: ['fs'],
    dependencySnapshot: { 'dep-alpha': '1.0.0' },
  };

  const result = await bridge.reload(request);
  assert.equal(result.response.kind, 'reload-complete');
  assert.equal(result.response.pluginId, 'alpha');
  assert.equal(result.response.manifestVersion, '1.0.0');

  const statusesByStage = new Map(result.stages.map((stage) => [stage.name, stage]));
  for (const name of stageOrder) {
    const status = statusesByStage.get(name);
    assert.ok(status, `missing stage status for ${name}`);
    assert.equal(status.status, 'success');
    assert.equal(typeof status.retryable, 'boolean');
  }

  const pluginState = bridge.getPluginState('alpha');
  assert.ok(pluginState);
  assert.deepEqual(pluginState.manifest, manifest);
  assert.deepEqual(pluginState.permissions, ['fs']);
  assert.deepEqual(pluginState.dependencies, { 'dep-alpha': '1.0.0' });
  assert.ok(pluginState.hooksRegistered);

  const logEvents = bridge.getCollectorMessages();
  assert.ok(logEvents.length > 0);
  assert.ok(logEvents.every((log) => log.tag === 'extension:plugin-bridge'));
  assert.ok(
    logEvents.some(
      (log) =>
        log.event === 'reload-complete' &&
        log.level === 'info' &&
        log.notifyUser === false,
    ),
  );
});

test('permission delta fails gate and produces non-retryable error', async () => {
  const bridge = createBridge();
  const baseManifest = {
    id: 'alpha',
    version: '0.9.0',
    minPlatformVersion: '1.34.0',
    permissions: ['fs'],
    dependencies: { 'dep-alpha': '1.0.0' },
    hooks: ['workspace.didOpen'],
  } as const;

  await bridge.reload({
    kind: 'plugins.reload',
    pluginId: 'alpha',
    manifest: baseManifest,
    grantedPermissions: ['fs'],
    dependencySnapshot: { 'dep-alpha': '1.0.0' },
  });

  const nextManifest = {
    ...baseManifest,
    version: '1.1.0',
    permissions: ['fs', 'net'],
  } as const;

  const result = await bridge.reload({
    kind: 'plugins.reload',
    pluginId: 'alpha',
    manifest: nextManifest,
    grantedPermissions: ['fs'],
    dependencySnapshot: { 'dep-alpha': '1.0.0' },
  });

  assert.equal(result.response.kind, 'reload-error');
  assert.equal(result.response.error.code, PluginReloadErrorCode.PermissionMismatch);
  assert.equal(result.response.error.retryable, false);
  assert.equal(result.response.error.stage, 'permission-gate');

  const latestState = bridge.getPluginState('alpha');
  assert.ok(latestState);
  assert.equal(latestState.manifest.version, '0.9.0');
  assert.deepEqual(latestState.permissions, ['fs']);

  const errorLog = bridge.getCollectorMessages().find((log) => log.event === 'stage-failed');
  assert.ok(errorLog);
  assert.equal(errorLog.notifyUser, true);
});

test('dependency mismatch triggers rollback and retryable error', async () => {
  const bridge = createBridge();
  const manifest = {
    id: 'beta',
    version: '2.0.0',
    minPlatformVersion: '1.34.0',
    permissions: ['fs'],
    dependencies: { 'dep-beta': '2.0.0' },
    hooks: ['workspace.didOpen'],
  } as const;

  await bridge.reload({
    kind: 'plugins.reload',
    pluginId: 'beta',
    manifest,
    grantedPermissions: ['fs'],
    dependencySnapshot: { 'dep-beta': '2.0.0' },
  });

  const incompatibleManifest = {
    ...manifest,
    version: '2.1.0',
    dependencies: { 'dep-beta': '3.0.0' },
  } as const;

  const result = await bridge.reload({
    kind: 'plugins.reload',
    pluginId: 'beta',
    manifest: incompatibleManifest,
    grantedPermissions: ['fs'],
    dependencySnapshot: { 'dep-beta': '2.0.0' },
  });

  assert.equal(result.response.kind, 'reload-error');
  assert.equal(result.response.error.code, PluginReloadErrorCode.DependencyMismatch);
  assert.equal(result.response.error.retryable, true);
  assert.equal(result.response.error.stage, 'dependency-cache');

  const state = bridge.getPluginState('beta');
  assert.ok(state);
  assert.equal(state.manifest.version, '2.0.0');
  assert.deepEqual(state.dependencies, { 'dep-beta': '2.0.0' });
  assert.ok(state.hooksRegistered);

  const rollbackLog = bridge
    .getCollectorMessages()
    .find((log) => log.event === 'rollback-executed' && log.stage === 'dependency-cache');
  assert.ok(rollbackLog, 'expected rollback log entry');
});

test('bridge creation is skipped when disabled flag is false', () => {
  const bridge = maybeCreatePluginBridge({
    enableFlag: false,
    platformVersion: '1.35.2',
    collector: {
      publish() {
        throw new Error('should not be called when disabled');
      },
    },
    phaseGuard: {
      ensureReloadAllowed() {
        throw new Error('should not be called when disabled');
      },
    },
    state: {
      manifests: new Map(),
      permissions: new Map(),
      dependencies: new Map(),
      hooks: new Set(),
    },
  });

  assert.equal(bridge, undefined);
});
