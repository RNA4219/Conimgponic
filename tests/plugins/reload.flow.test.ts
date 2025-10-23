import { test } from 'node:test'; import assert from 'node:assert/strict';
import { evaluateReload, type PluginReloadRequest, type ReloadContext } from '../../src/lib/plugin-bridge-reload';

const baseRequest: PluginReloadRequest = {
  type: 'plugins.reload', requestId: 'req-1', attempt: 1, manifestHash: 'hash',
  manifest: { id: 'sample.plugin', name: 'Sample Plugin', version: '1.2.3', engines: { vscode: '1.80.0' }, permissions: [], dependencies: [] }
};
const baseContext: ReloadContext = {
  pluginId: 'sample.plugin', bridgeVersion: '1.80.1', grantedPermissions: [], cachedDependencies: [], resolvableDependencies: []
};

test('reload success emits collector tag and ordered stages', () => {
  const outcome = evaluateReload(baseRequest, baseContext);
  assert.equal(outcome.response.type, 'plugins.reload-complete');
  assert.deepEqual(outcome.stages.map((s) => s.stage), [
    'manifest:validate', 'compat:check', 'permissions:gate', 'dependencies:cache', 'hooks:register'
  ]);
  const finalLog = outcome.logs.at(-1)!;
  assert.equal(finalLog.tags.result, 'applied');
  assert.equal(finalLog.scope, 'extension:plugin-bridge');
});

test('pending permission gates reload with non-retryable error', () => {
  const outcome = evaluateReload({ ...baseRequest, requestId: 'req-2', manifest: { ...baseRequest.manifest, permissions: ['fs:write'] } }, {
    ...baseContext, pendingPermissions: ['fs:write']
  });
  assert.equal(outcome.response.type, 'plugins.reload-error');
  assert.equal(outcome.response.code, 'E_PLUGIN_PERMISSION_PENDING');
  assert.equal(outcome.response.retryable, false);
  assert.equal(outcome.logs.at(-1)!.tags.result, 'rollback');
});

test('dependency miss surfaces retryable error and collector scope', () => {
  const outcome = evaluateReload({ ...baseRequest, requestId: 'req-3', manifest: { ...baseRequest.manifest, dependencies: ['day8-runtime'] } }, baseContext);
  assert.equal(outcome.response.type, 'plugins.reload-error');
  assert.equal(outcome.response.code, 'E_PLUGIN_DEP_RESOLVE');
  assert.equal(outcome.response.retryable, true);
  assert.equal(outcome.logs.at(-1)!.tags.result, 'rollback');
  assert.equal(outcome.logs.some((log) => log.scope === 'extension:plugin-bridge' && log.retryable === true), true);
});
