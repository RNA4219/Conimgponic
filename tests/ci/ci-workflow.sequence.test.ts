/// <reference types="node" />

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

type WorkflowYaml = {
  jobs?: {
    quality?: QualityJobConfig;
    reports?: {
      steps?: StepConfig[];
    };
  };
};

type QualityJobConfig = {
  strategy?: {
    matrix?: {
      include?: QualityMatrixEntry[];
    };
  };
};

type QualityMatrixEntry = {
  command?: unknown;
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
const expectedQualitySequence = [
  'pnpm -s lint',
  'pnpm -s typecheck',
  'pnpm -s test:autosave',
  'pnpm -s test:merge',
  'pnpm -s test:cli',
  'pnpm -s test:collector',
  'pnpm -s test:telemetry',
];

const expectedCoverageCommand = 'pnpm -s test:coverage';
const expectedJunitCommand = 'pnpm -s test:junit';

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
      const quality = workflow.jobs?.quality;
      if (!quality) {
        assert.fail('workflow.jobs.quality must exist');
      }

      const matrixEntries = quality.strategy?.matrix?.include;
      assertMatrixEntries(matrixEntries, 'quality job must configure matrix.include array');

      const qualityCommands = extractMatrixCommands(matrixEntries);

      const reports = workflow.jobs?.reports;
      if (!reports) {
        assert.fail('workflow.jobs.reports must exist');
      }

      const reportSteps = reports.steps;
      assertStepArray(reportSteps, 'workflow.jobs.reports.steps must be an array');

      assertCommandSequence(
        qualityCommands,
        expectedQualitySequence,
        'quality job matrix.include',
      );

      const reportCommands = extractPnpmCommands(reportSteps);

      assertCommandPresence(
        reportCommands,
        expectedCoverageCommand,
        'reports job must run coverage command',
      );

      assertCommandPresence(
        reportCommands,
        expectedJunitCommand,
        'reports job must generate JUnit report',
      );

      const artifactSteps = reportSteps.filter(isUploadArtifactStep);

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
    assert.fail(`reports job must upload artifact named "${expectedName}"`);
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

function extractPnpmCommands(steps: StepConfig[]): string[] {
  return steps.flatMap((step) => {
    if (typeof step.run !== 'string') {
      return [];
    }

    return step.run
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('pnpm '));
  });
}

function assertCommandSequence(
  commands: string[],
  expected: string[],
  context: string,
): void {
  let cursor = -1;

  for (const command of expected) {
    const nextIndex = commands.findIndex(
      (entry, index) => index > cursor && entry === command,
    );

    assert.notStrictEqual(
      nextIndex,
      -1,
      `${context} must include pnpm command "${command}" after index ${cursor}`,
    );

    cursor = nextIndex;
  }
}

function assertCommandPresence(commands: string[], expected: string, message: string): void {
  const index = commands.findIndex((command) => command === expected);

  assert.notStrictEqual(index, -1, message);
}

function assertStepArray(value: unknown, message: string): asserts value is StepConfig[] {
  if (!Array.isArray(value)) {
    assert.fail(message);
  }
}

function assertMatrixEntries(value: unknown, message: string): asserts value is QualityMatrixEntry[] {
  if (!Array.isArray(value)) {
    assert.fail(message);
  }
}

function extractMatrixCommands(entries: QualityMatrixEntry[]): string[] {
  return entries.flatMap((entry) => {
    if (typeof entry.command !== 'string') {
      return [];
    }

    return [entry.command.trim()];
  });
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
