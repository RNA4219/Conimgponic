/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bootstrapPluginBridge,
  type PluginBridgeBackingState,
  type PluginCollector,
  type PluginPhaseGuard,
} from '../../../src/platform/vscode/plugins/index.js';

import type { ResolveOptions } from '../../../src/config/index.js';

const createState = (): PluginBridgeBackingState => ({
  manifests: new Map(),
  permissions: new Map(),
  dependencies: new Map(),
  hooks: new Set(),
});

test('bootstrapPluginBridge skips initialization when plugin flag disabled', () => {
  const published: unknown[] = [];
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

  const bridge = bootstrapPluginBridge({
    platformVersion: '1.35.2',
    conimgApiVersion: '1',
    collector,
    phaseGuard,
    state: createState(),
    resolveOptions: { workspace },
  });

  assert.equal(bridge, undefined);
  assert.equal(published.length, 0);
});
