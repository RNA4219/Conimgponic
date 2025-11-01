/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveCollectorPhase } from '../../../src/platform/vscode/autosave/collector.js';
import { resolveCollectorPhase as baseResolveCollectorPhase } from '../../../src/lib/autosave/collector-phase.js';
import type { AutoSavePhaseGuardSnapshot } from '../../../src/lib/autosave.js';

test('collector exports the base resolveCollectorPhase implementation', () => {
  assert.equal(resolveCollectorPhase, baseResolveCollectorPhase);
});

test('collector resolveCollectorPhase preserves guard-derived phases', () => {
  const disabledGuard: AutoSavePhaseGuardSnapshot = {
    featureFlag: { value: false, source: 'env' },
    optionsDisabled: false,
  };
  assert.equal(resolveCollectorPhase(disabledGuard), 'A-0');

  const envGuard: AutoSavePhaseGuardSnapshot = {
    featureFlag: { value: true, source: 'env' },
    optionsDisabled: false,
  };
  assert.equal(resolveCollectorPhase(envGuard), 'A-1');

  const localStorageGuard: AutoSavePhaseGuardSnapshot = {
    featureFlag: { value: true, source: 'localStorage' },
    optionsDisabled: false,
  };
  assert.equal(resolveCollectorPhase(localStorageGuard), 'A-1');

  const workspaceGuard: AutoSavePhaseGuardSnapshot = {
    featureFlag: { value: true, source: 'workspace' },
    optionsDisabled: false,
  };
  assert.equal(resolveCollectorPhase(workspaceGuard), 'A-2');

  const unknownSourceGuard: AutoSavePhaseGuardSnapshot = {
    featureFlag: { value: true, source: 'other-source' },
    optionsDisabled: false,
  };
  assert.equal(resolveCollectorPhase(unknownSourceGuard), 'A-0');

  const disabledByOptionsGuard: AutoSavePhaseGuardSnapshot = {
    featureFlag: { value: true, source: 'workspace' },
    optionsDisabled: true,
  };
  assert.equal(resolveCollectorPhase(disabledByOptionsGuard), 'A-0');
});
