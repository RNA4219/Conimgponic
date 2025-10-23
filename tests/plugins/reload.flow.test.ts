import { test } from 'node:test'; import { strict as assert } from 'node:assert';
import { evaluateReload, type PluginReloadRequest, type ReloadContext } from '../../src/lib/plugin-bridge-reload.ts';

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
  const logTags = outcome.logs.map((log) => log.tags);
  assert.deepEqual(logTags.slice(0, 2), [
    {
      channel: 'extension:plugin-bridge', flow: 'plugins.reload', pluginId: 'sample.plugin', requestId: 'req-1',
      stage: 'manifest:validate', event: 'stage-start', outcome: 'start'
    },
    {
      channel: 'extension:plugin-bridge', flow: 'plugins.reload', pluginId: 'sample.plugin', requestId: 'req-1',
      stage: 'manifest:validate', event: 'stage-complete', outcome: 'complete'
    }
  ]);
  assert.deepEqual(logTags[logTags.length - 1], {
    channel: 'extension:plugin-bridge', flow: 'plugins.reload', pluginId: 'sample.plugin', requestId: 'req-1',
    event: 'reload-complete', outcome: 'applied'
  });
});

test('conimg-api mismatch fails compatibility stage', () => {
  const outcome = evaluateReload({
    ...baseRequest,
    requestId: 'req-compat',
    manifest: { ...baseRequest.manifest, 'conimg-api': '2' }
  }, baseContext);
  if (outcome.response.type !== 'plugins.reload-error') assert.fail('expected reload-error response');
  assert.equal(outcome.response.code, 'E_PLUGIN_INCOMPATIBLE');
  assert.equal(outcome.response.retryable, false);
  assert.equal(outcome.response.notifyUser, false);
  const failureLog = outcome.logs[outcome.logs.length - 1];
  assert.equal(failureLog.event, 'stage-failed');
  assert.equal(failureLog.stage, 'compat:check');
  assert.deepEqual(failureLog.tags, {
    channel: 'extension:plugin-bridge', flow: 'plugins.reload', pluginId: 'sample.plugin', requestId: 'req-compat',
    stage: 'compat:check', event: 'stage-failed', outcome: 'failed', code: 'E_PLUGIN_INCOMPATIBLE', retryable: 'false'
  });
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
  if (outcome.response.type !== 'plugins.reload-error') assert.fail('expected reload-error response');
  assert.equal(outcome.response.code, 'E_PLUGIN_PERMISSION_MISMATCH');
  assert.equal(outcome.response.retryable, false);
  assert.equal(outcome.response.notifyUser, true);
  const failingLog = outcome.logs[outcome.logs.length - 2];
  assert.equal(failingLog.event, 'stage-failed');
  assert.equal(failingLog.notifyUser, true);
  assert.deepEqual(failingLog.tags, {
    channel: 'extension:plugin-bridge', flow: 'plugins.reload', pluginId: 'sample.plugin', requestId: 'req-perm',
    stage: 'permissions:gate', event: 'stage-failed', outcome: 'failed', code: 'E_PLUGIN_PERMISSION_MISMATCH', retryable: 'false'
  });
  assert.equal(outcome.logs[outcome.logs.length - 1].event, 'rollback-executed');
  assert.deepEqual(outcome.logs[outcome.logs.length - 1].tags, {
    channel: 'extension:plugin-bridge', flow: 'plugins.reload', pluginId: 'sample.plugin', requestId: 'req-perm',
    stage: 'permissions:gate', event: 'rollback-executed', outcome: 'rollback', retryable: 'false'
  });
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
  if (outcome.response.type !== 'plugins.reload-error') assert.fail('expected reload-error response');
  assert.equal(outcome.response.code, 'E_PLUGIN_DEPENDENCY_MISMATCH');
  assert.equal(outcome.response.retryable, true);
  assert.equal(outcome.response.notifyUser, false);
  const failLog = outcome.logs[outcome.logs.length - 2];
  assert.equal(failLog.event, 'stage-failed');
  assert.equal(failLog.retryable, true);
  assert.deepEqual(failLog.tags, {
    channel: 'extension:plugin-bridge', flow: 'plugins.reload', pluginId: 'sample.plugin', requestId: 'req-deps',
    stage: 'dependencies:cache', event: 'stage-failed', outcome: 'failed', code: 'E_PLUGIN_DEPENDENCY_MISMATCH', retryable: 'true'
  });
  assert.equal(outcome.logs[outcome.logs.length - 1].event, 'rollback-executed');
  assert.deepEqual(outcome.logs[outcome.logs.length - 1].tags, {
    channel: 'extension:plugin-bridge', flow: 'plugins.reload', pluginId: 'sample.plugin', requestId: 'req-deps',
    stage: 'dependencies:cache', event: 'rollback-executed', outcome: 'rollback', retryable: 'true'
  });
});
