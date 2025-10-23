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
    conimgApiVersion: '1',
    collector: {
      publish() {
        // noop: bridge#getCollectorMessages provides captured logs for assertions
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
    engines: { vscode: '1.35.0' },
    'conimg-api': '1',
    permissions: ['fs'],
    dependencies: { npm: { 'dep-alpha': '1.0.0' }, workspace: ['packages/alpha'] },
    hooks: ['workspace.didOpen'],
  } as const;

  const request: PluginReloadRequest = {
    kind: 'plugins.reload',
    pluginId: 'alpha',
    manifest,
    grantedPermissions: ['fs'],
    dependencySnapshot: { npm: { 'dep-alpha': '1.0.0' }, workspace: ['packages/alpha'] },
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
  assert.deepEqual(pluginState.dependencies, {
    npm: { 'dep-alpha': '1.0.0' },
    workspace: ['packages/alpha'],
  });
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
    engines: { vscode: '1.35.0' },
    'conimg-api': '1',
    permissions: ['fs'],
    dependencies: { npm: { 'dep-alpha': '1.0.0' }, workspace: ['packages/alpha'] },
    hooks: ['workspace.didOpen'],
  } as const;

  await bridge.reload({
    kind: 'plugins.reload',
    pluginId: 'alpha',
    manifest: baseManifest,
    grantedPermissions: ['fs'],
    dependencySnapshot: { npm: { 'dep-alpha': '1.0.0' }, workspace: ['packages/alpha'] },
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
    dependencySnapshot: { npm: { 'dep-alpha': '1.0.0' }, workspace: ['packages/alpha'] },
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
    engines: { vscode: '1.35.0' },
    'conimg-api': '1',
    permissions: ['fs'],
    dependencies: { npm: { 'dep-beta': '2.0.0' }, workspace: ['packages/beta'] },
    hooks: ['workspace.didOpen'],
  } as const;

  await bridge.reload({
    kind: 'plugins.reload',
    pluginId: 'beta',
    manifest,
    grantedPermissions: ['fs'],
    dependencySnapshot: { npm: { 'dep-beta': '2.0.0' }, workspace: ['packages/beta'] },
  });

  const incompatibleManifest = {
    ...manifest,
    version: '2.1.0',
    dependencies: { npm: { 'dep-beta': '3.0.0' }, workspace: ['packages/beta'] },
  } as const;

  const result = await bridge.reload({
    kind: 'plugins.reload',
    pluginId: 'beta',
    manifest: incompatibleManifest,
    grantedPermissions: ['fs'],
    dependencySnapshot: { npm: { 'dep-beta': '2.0.0' }, workspace: ['packages/beta'] },
  });

  assert.equal(result.response.kind, 'reload-error');
  assert.equal(result.response.error.code, PluginReloadErrorCode.DependencyMismatch);
  assert.equal(result.response.error.retryable, true);
  assert.equal(result.response.error.stage, 'dependency-cache');

  const state = bridge.getPluginState('beta');
  assert.ok(state);
  assert.equal(state.manifest.version, '2.0.0');
  assert.deepEqual(state.dependencies, {
    npm: { 'dep-beta': '2.0.0' },
    workspace: ['packages/beta'],
  });
  assert.ok(state.hooksRegistered);

  const rollbackLog = bridge
    .getCollectorMessages()
    .find((log) => log.event === 'rollback-executed' && log.stage === 'dependency-cache');
  assert.ok(rollbackLog, 'expected rollback log entry');

  const workspaceDependencies = {
    npm: { 'dep-gamma': '3.0.0' },
    workspace: ['packages/gamma/a.ts'],
  } as const;
  const gammaManifest = {
    id: 'gamma',
    version: '3.0.0',
    engines: { vscode: '1.35.0' },
    'conimg-api': '1',
    permissions: ['fs'],
    dependencies: workspaceDependencies,
    hooks: ['workspace.didOpen'],
  } as const;

  await bridge.reload({
    kind: 'plugins.reload',
    pluginId: 'gamma',
    manifest: gammaManifest,
    grantedPermissions: ['fs'],
    dependencySnapshot: workspaceDependencies,
  });

  const workspaceResult = await bridge.reload({
    kind: 'plugins.reload',
    pluginId: 'gamma',
    manifest: {
      ...gammaManifest,
      version: '3.1.0',
      dependencies: {
        npm: workspaceDependencies.npm,
        workspace: [...workspaceDependencies.workspace, 'packages/gamma/b.ts'],
      },
    },
    grantedPermissions: ['fs'],
    dependencySnapshot: workspaceDependencies,
  });

  assert.equal(workspaceResult.response.kind, 'reload-error');
  assert.equal(workspaceResult.response.error.code, PluginReloadErrorCode.DependencyMismatch);
  assert.equal(workspaceResult.response.error.retryable, true);
  assert.equal(workspaceResult.response.error.stage, 'dependency-cache');

  const gammaStatuses = new Map(workspaceResult.stages.map((stage) => [stage.name, stage]));
  assert.equal(gammaStatuses.get('manifest-validation')?.status, 'success');
  assert.equal(gammaStatuses.get('compatibility-check')?.status, 'success');
  assert.equal(gammaStatuses.get('permission-gate')?.status, 'success');
  const workspaceStage = gammaStatuses.get('dependency-cache');
  assert.ok(workspaceStage && workspaceStage.status === 'failed');
  assert.equal(workspaceStage.retryable, true);
  assert.equal(gammaStatuses.get('hook-registration')?.status, 'pending');

  const workspaceLog = bridge
    .getCollectorMessages()
    .filter((log) => log.pluginId === 'gamma')
    .find((log) => log.event === 'stage-failed' && log.stage === 'dependency-cache');
  assert.ok(workspaceLog);
  assert.equal(workspaceLog.notifyUser, false);
});


test('conimg-api mismatch fails compatibility check with notifyUser log', async () => {
  const bridge = createBridge();
  const manifest = {
    id: 'delta',
    version: '1.0.0',
    engines: { vscode: '1.35.0' },
    'conimg-api': '2',
    permissions: [],
    dependencies: { npm: {}, workspace: [] },
    hooks: ['workspace.didOpen'],
  } as const;

  const result = await bridge.reload({
    kind: 'plugins.reload',
    pluginId: 'delta',
    manifest,
    grantedPermissions: [],
    dependencySnapshot: { npm: {}, workspace: [] },
  });

  assert.equal(result.response.kind, 'reload-error');
  assert.equal(result.response.error.code, PluginReloadErrorCode.IncompatiblePlatform);
  assert.equal(result.response.error.stage, 'compatibility-check');
  assert.equal(result.response.error.retryable, false);

  const failureLog = bridge
    .getCollectorMessages()
    .find((log) => log.event === 'stage-failed' && log.stage === 'compatibility-check');
  assert.ok(failureLog);
  assert.equal(failureLog.notifyUser, true);
});

test('conimg-api mismatch logs incompatibility metadata for collector', async () => {
  const bridge = createBridge();
  const manifest = {
    id: 'zeta',
    version: '1.0.0',
    engines: { vscode: '1.35.0' },
    'conimg-api': '2',
    permissions: [],
    dependencies: { npm: {}, workspace: [] },
    hooks: ['workspace.didOpen'],
  } as const;

  await bridge.reload({
    kind: 'plugins.reload',
    pluginId: 'zeta',
    manifest,
    grantedPermissions: [],
    dependencySnapshot: { npm: {}, workspace: [] },
  });

  const failureLog = bridge
    .getCollectorMessages()
    .find((log) => log.pluginId === 'zeta' && log.event === 'stage-failed' && log.stage === 'compatibility-check');

  assert.ok(failureLog, 'expected compatibility failure log');
  assert.equal(failureLog?.detail?.code, PluginReloadErrorCode.IncompatiblePlatform);
  assert.equal(failureLog?.detail?.retryable, false);
  assert.equal(typeof failureLog?.detail?.reason, 'string');
});

test('bridge creation is skipped when disabled flag is false', () => {
  const bridge = maybeCreatePluginBridge({
    enableFlag: false,
    platformVersion: '1.35.2',
    conimgApiVersion: '1',
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

test('phase guard blocked emits notifyUser log with E_PLUGIN_PHASE_BLOCKED', async () => {
  const collectorMessages: unknown[] = [];
  const bridge = maybeCreatePluginBridge({
    enableFlag: true,
    platformVersion: '1.35.2',
    conimgApiVersion: '1',
    collector: {
      publish(message) {
        collectorMessages.push(message);
      },
    },
    phaseGuard: {
      ensureReloadAllowed() {
        return false;
      },
    },
    state: {
      manifests: new Map(),
      permissions: new Map(),
      dependencies: new Map(),
      hooks: new Set(),
    },
  });

  assert.ok(bridge);

  const manifest = {
    id: 'epsilon',
    version: '1.0.0',
    engines: { vscode: '1.35.0' },
    'conimg-api': '1',
    permissions: [],
    dependencies: { npm: {}, workspace: [] },
    hooks: ['workspace.didOpen'],
  } as const;

  const result = await bridge.reload({
    kind: 'plugins.reload',
    pluginId: 'epsilon',
    manifest,
    grantedPermissions: [],
    dependencySnapshot: { npm: {}, workspace: [] },
  });

  assert.equal(result.response.kind, 'reload-error');
  assert.equal(result.response.error.code, PluginReloadErrorCode.PhaseGuardBlocked);
  assert.equal(result.response.error.notifyUser, true);

  const failureLog = collectorMessages.find(
    (log: any) => log.event === 'stage-failed' && log.stage === 'manifest-validation',
  ) as { notifyUser: boolean } | undefined;
  assert.ok(failureLog);
  assert.equal(failureLog.notifyUser, true);
});

test('phase guard blocked log includes error code for collector analysis', async () => {
  const collectorMessages: unknown[] = [];
  const bridge = maybeCreatePluginBridge({
    enableFlag: true,
    platformVersion: '1.35.2',
    conimgApiVersion: '1',
    collector: {
      publish(message) {
        collectorMessages.push(message);
      },
    },
    phaseGuard: {
      ensureReloadAllowed() {
        return false;
      },
    },
    state: {
      manifests: new Map(),
      permissions: new Map(),
      dependencies: new Map(),
      hooks: new Set(),
    },
  });

  assert.ok(bridge);

  await bridge.reload({
    kind: 'plugins.reload',
    pluginId: 'theta',
    manifest: {
      id: 'theta',
      version: '1.0.0',
      engines: { vscode: '1.35.0' },
      'conimg-api': '1',
      permissions: [],
      dependencies: { npm: {}, workspace: [] },
      hooks: ['workspace.didOpen'],
    },
    grantedPermissions: [],
    dependencySnapshot: { npm: {}, workspace: [] },
  });

  const failureLog = collectorMessages.find(
    (log: any) => log.pluginId === 'theta' && log.event === 'stage-failed' && log.stage === 'manifest-validation',
  ) as { detail?: { code?: string; retryable?: boolean } } | undefined;

  assert.ok(failureLog);
  assert.equal(failureLog?.detail?.code, PluginReloadErrorCode.PhaseGuardBlocked);
  assert.equal(failureLog?.detail?.retryable, false);
});

test('workspace dependency diff is surfaced in collector detail snapshot', async () => {
  const bridge = createBridge();
  const baseDependencies = { npm: { 'dep-gamma': '3.0.0' }, workspace: ['packages/gamma/a.ts'] } as const;
  const manifest = {
    id: 'iota',
    version: '1.0.0',
    engines: { vscode: '1.35.0' },
    'conimg-api': '1',
    permissions: ['fs'],
    dependencies: baseDependencies,
    hooks: ['workspace.didOpen'],
  } as const;

  await bridge.reload({
    kind: 'plugins.reload',
    pluginId: 'iota',
    manifest,
    grantedPermissions: ['fs'],
    dependencySnapshot: baseDependencies,
  });

  await bridge.reload({
    kind: 'plugins.reload',
    pluginId: 'iota',
    manifest: {
      ...manifest,
      version: '1.1.0',
      dependencies: {
        npm: baseDependencies.npm,
        workspace: [...baseDependencies.workspace, 'packages/gamma/b.ts'],
      },
    },
    grantedPermissions: ['fs'],
    dependencySnapshot: baseDependencies,
  });

  const failureLog = bridge
    .getCollectorMessages()
    .find((log) => log.pluginId === 'iota' && log.event === 'stage-failed' && log.stage === 'dependency-cache');

  assert.ok(failureLog, 'expected dependency mismatch log');
  assert.equal(failureLog?.detail?.code, PluginReloadErrorCode.DependencyMismatch);
  assert.equal(failureLog?.detail?.retryable, true);
  assert.deepEqual(failureLog?.detail?.diff, {
    npm: { added: [], removed: [], changed: [] },
    workspace: { added: ['packages/gamma/b.ts'], removed: [] },
  });
});
