/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, beforeEach, test } from 'node:test';

import { clearModuleCache, importJsYaml, loadWorkflow } from './utils/workflow-loader.js';

describe('ci workflow loader utility', () => {
  beforeEach(() => {
    clearModuleCache();
  });

  test('importJsYaml caches module instance until cache is cleared', async () => {
    const first = await importJsYaml();
    const second = await importJsYaml();
    assert.equal(second, first, 'importJsYaml should return cached module when available');

    clearModuleCache();

    const third = await importJsYaml();
    assert.notEqual(third, first, 'importJsYaml should reload module after cache is cleared');
  });

  test('loadWorkflow parses ci.yml and exposes jobs definition', async () => {
    const workflow = await loadWorkflow();
    assert.ok(workflow && typeof workflow === 'object', 'workflow must be an object');
    assert.ok('jobs' in workflow, 'workflow must include jobs property');
  });

  test('loadWorkflow reuses parsed workflow until cache is cleared', async () => {
    const first = await loadWorkflow();
    const second = await loadWorkflow();
    assert.equal(second, first, 'loadWorkflow should reuse cached workflow');

    clearModuleCache();

    const third = await loadWorkflow();
    assert.notEqual(third, first, 'loadWorkflow should reload workflow after cache is cleared');
  });
});
