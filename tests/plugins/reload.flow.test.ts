import { test } from 'node:test'; import assert from 'node:assert/strict';
import { evaluateReload, type PluginReloadRequest, type ReloadContext } from '../../src/lib/plugin-bridge-reload';

const baseRequest: PluginReloadRequest = {
  type: 'plugins.reload', requestId: 'req-1', attempt: 1, manifestHash: 'hash',
  manifest: {
    id: 'sample.plugin', name: 'Sample Plugin', version: '1.2.3', engines: { vscode: '1.80.0' },
    'conimg-api': '1', permissions: [], hooks: [], dependencies: { npm: {}, workspace: [] }
  }
};
const baseContext: ReloadContext = {
  pluginId: 'sample.plugin', bridgeVersion: '1.80.1', supportedConimgApi: ['1'], grantedPermissions: [],
  cachedDependencies: { npm: {}, workspace: [] }, resolvableDependencies: { npm: {}, workspace: [] }
};

test('reload success emits collector tag and ordered stages', () => {
  const outcome = evaluateReload(baseRequest, baseContext);
  assert.equal(outcome.response.type, 'plugins.reload-complete');
  assert.deepEqual(outcome.stages.map((s) => s.stage), [
    'manifest:validate', 'compat:check', 'permissions:gate', 'dependencies:cache', 'hooks:register'
  ]);
  assert.deepEqual(
    outcome.logs.map((log) => ({ event: log.event, stage: log.stage, notifyUser: log.notifyUser })),
    [
      { event: 'stage-start', stage: 'manifest:validate', notifyUser: false },
      { event: 'stage-complete', stage: 'manifest:validate', notifyUser: false },
      { event: 'stage-start', stage: 'compat:check', notifyUser: false },
      { event: 'stage-complete', stage: 'compat:check', notifyUser: false },
      { event: 'stage-start', stage: 'permissions:gate', notifyUser: false },
      { event: 'stage-complete', stage: 'permissions:gate', notifyUser: false },
      { event: 'stage-start', stage: 'dependencies:cache', notifyUser: false },
      { event: 'stage-complete', stage: 'dependencies:cache', notifyUser: false },
      { event: 'stage-start', stage: 'hooks:register', notifyUser: false },
      { event: 'stage-complete', stage: 'hooks:register', notifyUser: false },
      { event: 'reload-complete', stage: undefined, notifyUser: false }
    ]
  );
});

test('conimg-api mismatch fails compatibility stage', () => {
  const outcome = evaluateReload({
    ...baseRequest,
    requestId: 'req-compat',
    manifest: { ...baseRequest.manifest, 'conimg-api': '2' }
  }, baseContext);
  assert.equal(outcome.response.type, 'plugins.reload-error');
  assert.equal(outcome.response.code, 'E_PLUGIN_INCOMPATIBLE');
  assert.equal(outcome.response.retryable, false);
  assert.equal(outcome.response.notifyUser, false);
  assert.equal(outcome.logs.at(-1)!.event, 'stage-failed');
  assert.equal(outcome.logs.at(-1)!.stage, 'compat:check');
});

test('permission mismatch notifies user and stops reload', () => {
  const outcome = evaluateReload({
    ...baseRequest,
    requestId: 'req-perm',
    manifest: { ...baseRequest.manifest, permissions: ['fs:write'] }
  }, {
    ...baseContext,
    grantedPermissions: [],
    pendingPermissions: ['fs:write']
  });
  assert.equal(outcome.response.type, 'plugins.reload-error');
  assert.equal(outcome.response.code, 'E_PLUGIN_PERMISSION_MISMATCH');
  assert.equal(outcome.response.retryable, false);
  assert.equal(outcome.response.notifyUser, true);
  const failingLog = outcome.logs.at(-2)!;
  assert.equal(failingLog.event, 'stage-failed');
  assert.equal(failingLog.notifyUser, true);
  assert.equal(outcome.logs.at(-1)!.event, 'rollback-executed');
});

test('dependency mismatch across npm and workspace is retryable', () => {
  const outcome = evaluateReload({
    ...baseRequest,
    requestId: 'req-deps',
    manifest: {
      ...baseRequest.manifest,
      dependencies: { npm: { 'day8-runtime': '1.0.0' }, workspace: ['packages/ui'] }
    }
  }, {
    ...baseContext,
    cachedDependencies: { npm: { 'day8-runtime': '0.9.0' }, workspace: ['packages/api'] },
    resolvableDependencies: { npm: {}, workspace: [] }
  });
  assert.equal(outcome.response.type, 'plugins.reload-error');
  assert.equal(outcome.response.code, 'E_PLUGIN_DEPENDENCY_MISMATCH');
  assert.equal(outcome.response.retryable, true);
  assert.equal(outcome.response.notifyUser, false);
  const failLog = outcome.logs.at(-2)!;
  assert.equal(failLog.event, 'stage-failed');
  assert.equal(failLog.retryable, true);
  assert.equal(outcome.logs.at(-1)!.event, 'rollback-executed');
});
