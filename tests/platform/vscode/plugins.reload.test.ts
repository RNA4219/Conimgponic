/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  maybeCreatePluginBridge,
  PluginReloadErrorCode,
  type PluginBridge,
  type PluginReloadRequest,
  type PluginReloadStageStatus,
} from '../../../src/platform/vscode/plugins/index.js';

const stageOrder = ['manifest-validation', 'compatibility-check', 'permission-gate', 'dependency-cache', 'hook-registration'] as const;
type StageName = (typeof stageOrder)[number];

const createBridge = (): PluginBridge => {
  const bridge = maybeCreatePluginBridge({
    enableFlag: true,
    platformVersion: '1.35.2',
    conimgApiVersion: '1',
    collector: { publish() {} },
    phaseGuard: { ensureReloadAllowed: (phase) => phase === 'plugins:reload' },
    state: { manifests: new Map(), permissions: new Map(), dependencies: new Map(), hooks: new Set() },
  });
  assert.ok(bridge);
  return bridge;
};

const baseRequest: PluginReloadRequest = {
  kind: 'plugins.reload',
  pluginId: 'sample.plugin',
  manifest: { id: 'sample.plugin', version: '1.0.0', engines: { vscode: '1.35.0' }, 'conimg-api': '1' },
  grantedPermissions: [],
  dependencySnapshot: { npm: {}, workspace: [] },
};

const mapStatuses = (stages: readonly PluginReloadStageStatus[]): Map<StageName, PluginReloadStageStatus> =>
  new Map(stages.map((status) => [status.name as StageName, status]));

test('hook-registration rejects unknown hooks without notifying user', async () => {
  const bridge = createBridge();
  const request: PluginReloadRequest = { ...baseRequest, manifest: { ...baseRequest.manifest, hooks: ['onCompile', 'notAllowedHook'] } };
  const result = await bridge.reload(request);
  assert.equal(result.response.kind, 'reload-error');

  const { error } = result.response;
  assert.equal(error.stage, 'hook-registration');
  assert.equal(error.code, PluginReloadErrorCode.HookRegistrationFailed);
  assert.equal(error.retryable, true);
  assert.equal(error.notifyUser, false);
  assert.deepEqual(error.detail, { invalidHooks: ['notAllowedHook'] });

  const statuses = mapStatuses(result.stages);
  for (const name of stageOrder.slice(0, 4)) assert.equal(statuses.get(name)?.status, 'success');

  const hookStatus = statuses.get('hook-registration');
  assert.equal(hookStatus?.status, 'failed');
  assert.equal(hookStatus?.error?.code, PluginReloadErrorCode.HookRegistrationFailed);
  assert.deepEqual(hookStatus?.error?.detail, { invalidHooks: ['notAllowedHook'] });

  assert.equal(bridge.getPluginState('sample.plugin'), undefined);

  const failureLog = bridge.getCollectorMessages().find((message) => message.event === 'stage-failed');
  assert.ok(failureLog);
  assert.equal(failureLog.event, 'stage-failed');
  assert.equal(failureLog.notifyUser, false);
  assert.equal(failureLog.stage, 'hook-registration');
  assert.equal(failureLog.detail?.code, PluginReloadErrorCode.HookRegistrationFailed);
  assert.deepEqual(failureLog.detail?.invalidHooks, ['notAllowedHook']);
});

test('hook-registration accepts hooks declared in the allow list', async () => {
  const bridge = createBridge();
  const request: PluginReloadRequest = { ...baseRequest, manifest: { ...baseRequest.manifest, hooks: ['onCompile', 'widgets', 'commands'] } };
  const result = await bridge.reload(request);
  assert.equal(result.response.kind, 'reload-complete');

  const statuses = mapStatuses(result.stages);
  for (const name of stageOrder) assert.equal(statuses.get(name)?.status, 'success');

  const state = bridge.getPluginState('sample.plugin');
  assert.ok(state);
  assert.ok(state.hooksRegistered);
  assert.deepEqual(state.manifest.hooks, ['onCompile', 'widgets', 'commands']);

  const stageCompleteLog = bridge
    .getCollectorMessages()
    .find((message) => message.event === 'stage-complete' && message.stage === 'hook-registration');
  assert.ok(stageCompleteLog);
  assert.deepEqual(stageCompleteLog.detail?.registeredHooks, ['onCompile', 'widgets', 'commands']);
  assert.equal(stageCompleteLog.detail?.hooksRegistered, true);
});
