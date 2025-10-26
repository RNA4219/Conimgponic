/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';

import { statusPhaseForState } from '../../../src/platform/vscode/autosave.js';

test('statusPhaseForState returns backoff for backoff state', () => {
  assert.equal(statusPhaseForState('backoff'), 'backoff');
});
