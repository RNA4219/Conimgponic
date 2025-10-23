import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

type WorkflowYaml = {
  jobs?: {
    build?: {
      steps?: StepConfig[];
    };
  };
};

type StepConfig = {
  run?: unknown;
};

type JsYamlModule = {
  load: (input: string) => unknown;
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '..', '..');
const workflowPath = resolve(repoRoot, '.github', 'workflows', 'ci.yml');
const require = createRequire(import.meta.url);
const { load } = require('js-yaml') as JsYamlModule;

describe('ci workflow build job', () => {
  test('runs recommended pnpm commands for autosave and reports', async () => {
    const source = await readFile(workflowPath, 'utf8');
    const parsed = load(source) as unknown;

    assert.ok(parsed && typeof parsed === 'object', 'workflow must parse to an object');

    const workflow = parsed as WorkflowYaml;
    const build = workflow.jobs?.build;
    assert.ok(build, 'workflow.jobs.build must exist');

    const steps = build.steps;
    assert.ok(Array.isArray(steps), 'workflow.jobs.build.steps must be an array');

    const runCommands = steps
      .map((step) => (typeof step.run === 'string' ? step.run : null))
      .filter((command): command is string => command !== null);

    const expectedSequence = [
      'pnpm -s lint',
      'pnpm -s typecheck',
      'pnpm test --filter autosave',
      'pnpm test -- --coverage',
      'pnpm test -- --reporter junit',
    ];

    let cursor = -1;

    for (const expected of expectedSequence) {
      const nextIndex = runCommands.findIndex((command, index) => index > cursor && command.includes(expected));

      assert.notStrictEqual(
        nextIndex,
        -1,
        `build job must include a step running "${expected}" after index ${cursor}`,
      );

      cursor = nextIndex;
    }
  });
});
