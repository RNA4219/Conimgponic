/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  maybeCreatePluginBridge,
  PluginReloadErrorCode,
  type PluginBridge,
  type PluginBridgeBackingState,
  type PluginBridgeLogMessage,
  type PluginCollector,
  type PluginManifest,
  type PluginReloadRequest,
} from '../../../src/platform/vscode/plugins/index.js';

const createState = (): PluginBridgeBackingState => ({
  manifests: new Map(),
  permissions: new Map(),
  dependencies: new Map(),
  hooks: new Set(),
});

const createBridge = () => {
  const messages: PluginBridgeLogMessage[] = [];
  const collector: PluginCollector = {
    publish(message) {
      messages.push(message);
    },
  };
  const bridge = maybeCreatePluginBridge({
    enableFlag: true,
    platformVersion: '1.35.2',
    conimgApiVersion: '1',
    collector,
    phaseGuard: { ensureReloadAllowed: () => true },
    state: createState(),
  });
  assert.ok(bridge, 'bridge should be created when enableFlag=true');
  return { bridge: bridge as PluginBridge, messages };
};

const createRequest = (manifest: PluginManifest): PluginReloadRequest => ({
  kind: 'plugins.reload',
  pluginId: 'sample.plugin',
  manifest,
  grantedPermissions: ['fs:read'],
  dependencySnapshot: { npm: {}, workspace: [] },
});

const findStageFailed = (messages: readonly PluginBridgeLogMessage[]): PluginBridgeLogMessage | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (entry.event === 'stage-failed') {
      return entry;
    }
  }
  return undefined;
};

const validManifestBase: PluginManifest = {
  id: 'sample.plugin',
  version: '1.2.3',
  engines: { vscode: '1.35.0' },
  'conimg-api': '1',
  permissions: ['fs:read'],
};

type ManifestValidationCase = {
  readonly description: string;
  readonly manifest: PluginManifest;
  readonly message: string;
  readonly detailField: string;
  readonly detailIssue: string;
  readonly notifyUser?: boolean;
};

const CASES: readonly ManifestValidationCase[] = [
  {
    description: 'rejects manifest with invalid plugin id format',
    manifest: { ...validManifestBase, id: 'Invalid Id!' },
    message: 'Manifest validation failed: invalid plugin identifier.',
    detailField: 'id',
    detailIssue: 'invalid-format',
    notifyUser: true,
  },
  {
    description: 'rejects manifest when version is not semver',
    manifest: { ...validManifestBase, version: '1.2' },
    message: 'Manifest validation failed: version must follow semver (major.minor.patch).',
    detailField: 'version',
    detailIssue: 'invalid-semver',
  },
  {
    description: 'rejects manifest with non-string permissions',
    manifest: { ...validManifestBase, permissions: ['fs:read', 123 as unknown as string] },
    message: 'Manifest validation failed: permissions must be an array of non-empty strings.',
    detailField: 'permissions',
    detailIssue: 'invalid-element',
  },
];

for (const { description, manifest, message, detailField, detailIssue, notifyUser } of CASES) {
  test(`plugins.reload ${description}`, async () => {
    const { bridge, messages } = createBridge();
    const result = await bridge.reload(createRequest(manifest));
    assert.equal(result.response.kind, 'reload-error');
    assert.equal(result.response.error.code, PluginReloadErrorCode.ManifestInvalid);
    assert.equal(result.response.error.message, message);
    assert.equal(result.stages[0]?.status, 'failed');
    if (notifyUser !== undefined) {
      assert.equal(result.response.error.notifyUser, notifyUser);
    }
    const failedLog = findStageFailed(messages);
    assert.ok(failedLog, 'stage-failed log should be published');
    assert.equal(failedLog?.stage, 'manifest-validation');
    assert.equal(failedLog?.detail?.field, detailField);
    assert.equal(failedLog?.detail?.issue, detailIssue);
  });
}
