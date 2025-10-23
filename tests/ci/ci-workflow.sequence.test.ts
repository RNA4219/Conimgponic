/// <reference types="node" />

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
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
  uses?: unknown;
  with?: unknown;
};

type UploadArtifactStep = StepConfig & {
  uses: string;
  with?: {
    name?: unknown;
    path?: unknown;
  };
};

type JsYamlModule = {
  load: (input: string) => unknown;
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '..', '..');
const workflowPath = resolve(repoRoot, '.github', 'workflows', 'ci.yml');
const require = createRequire(import.meta.url);
const { load } = await importJsYaml();

describe('ci workflow build job', () => {
  test('runs recommended pnpm commands for autosave and reports', async () => {
    try {
      const source = await readFile(workflowPath, 'utf8');
      const parsed = load(source) as unknown;

      if (!parsed || typeof parsed !== 'object') {
        assert.fail('workflow must parse to an object');
      }

      const workflow = parsed as WorkflowYaml;
      const build = workflow.jobs?.build;
      if (!build) {
        assert.fail('workflow.jobs.build must exist');
      }

      const steps = build.steps;
      assertStepArray(steps, 'workflow.jobs.build.steps must be an array');

      const runCommands = steps
        .map((step) => (typeof step.run === 'string' ? step.run : null))
        .filter((command): command is string => command !== null);

      const expectedSequence = [
        'pnpm -s lint',
        'pnpm -s typecheck',
        'pnpm test --filter autosave',
        'pnpm test --filter merge',
        'pnpm test --filter cli',
        'pnpm test --filter collector',
        'pnpm test --filter telemetry',
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

      const artifactSteps = steps.filter(isUploadArtifactStep);

      assertArtifactStep(artifactSteps, 'coverage', 'coverage/');
      assertArtifactStep(artifactSteps, 'junit-report', 'reports/junit.xml');
    } catch (error) {
      console.error('CI workflow verification failed:', error);
      throw error;
    }
  });
});

function isUploadArtifactStep(step: StepConfig): step is UploadArtifactStep {
  if (typeof step.uses !== 'string') {
    return false;
  }

  return step.uses.trim() === 'actions/upload-artifact@v4';
}

function assertArtifactStep(
  steps: UploadArtifactStep[],
  expectedName: string,
  expectedPath: string,
): void {
  const match = steps.find((step) => {
    const config = step.with;
    if (!config || typeof config !== 'object') {
      return false;
    }

    const { name } = config;
    return typeof name === 'string' && name.trim() === expectedName;
  });

  if (!match) {
    assert.fail(`build job must upload artifact named "${expectedName}"`);
  }

  const config = match.with;
  if (!config || typeof config !== 'object') {
    assert.fail(`artifact "${expectedName}" must define with section`);
  }

  const { name, path } = config;
  if (typeof name !== 'string') {
    assert.fail(`artifact "${expectedName}" must define name as a string`);
  }

  if (typeof path !== 'string') {
    assert.fail(`artifact "${expectedName}" must configure path as a string`);
  }

  assert.strictEqual(
    path.trim(),
    expectedPath,
    `artifact "${expectedName}" must target path "${expectedPath}"`,
  );
}

function assertStepArray(value: unknown, message: string): asserts value is StepConfig[] {
  if (!Array.isArray(value)) {
    assert.fail(message);
  }
}

async function importJsYaml(): Promise<JsYamlModule> {
  try {
    return require('js-yaml') as JsYamlModule;
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
  }

  const pnpmDir = resolve(repoRoot, 'node_modules', '.pnpm');
  const entries = await readdir(pnpmDir, { withFileTypes: true });
  const match = entries.find((entry) => entry.isDirectory() && entry.name.startsWith('js-yaml@'));

  if (!match) {
    assert.fail('js-yaml must be present in pnpm store');
  }

  const moduleDir = resolve(pnpmDir, match.name, 'node_modules', 'js-yaml');
  const moduleRequire = createRequire(resolve(moduleDir, 'index.js'));
  return moduleRequire('.') as JsYamlModule;
}

type NodeError = Error & {
  code?: string;
};

function isNodeError(error: unknown): error is NodeError {
  return error instanceof Error && 'code' in error;
}
