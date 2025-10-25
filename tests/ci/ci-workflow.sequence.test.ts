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
    audit?: AuditJobConfig;
    reports?: {
      steps?: StepConfig[];
    };
    build?: BuildJobConfig;
  };
};

type AuditJobConfig = {
  steps?: StepConfig[];
};

type BuildJobConfig = {
  needs?: JobNeedsConfig;
};

type QualityJobConfig = {
  strategy?: {
    matrix?: {
      include?: QualityMatrixEntry[];
    };
  };
  steps?: StepConfig[];
};

type QualityMatrixEntry = {
  command?: unknown;
};

type JobNeedsConfig = string | string[] | undefined;

type StepConfig = {
  run?: unknown;
  uses?: unknown;
  with?: unknown;
  name?: unknown;
  if?: unknown;
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
const expectedCoverageCleanup = 'rm -rf coverage';
const expectedJunitCommand =
  'pnpm test -- --test-reporter junit --test-reporter-destination reports/junit.xml';

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

      const qualitySteps = quality.steps;
      assertStepArray(qualitySteps, 'workflow.jobs.quality.steps must be an array');

      const reportFailureStep = assertStepWithName(
        qualitySteps,
        'Report suite failure',
        'quality job must include "Report suite failure" step',
      );

      assertStepIfEquals(
        reportFailureStep,
        "steps.run_suite.outcome == 'failure'",
        '"Report suite failure" step must run only when the suite fails',
      );

      assertStepRunIncludesLine(
        reportFailureStep,
        'exit 1',
        '"Report suite failure" step must terminate the job with exit 1',
      );

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

      assertRunScriptHasPrecedingLine(
        reportSteps,
        expectedCoverageCommand,
        expectedCoverageCleanup,
        'reports job must remove coverage directory before running coverage command',
      );

      assertCommandPresence(
        reportCommands,
        expectedJunitCommand,
        'reports job must generate JUnit report',
      );

      const artifactSteps = reportSteps.filter(isUploadArtifactStep);

      assertArtifactStep(artifactSteps, 'coverage', 'coverage/');
      assertArtifactStep(artifactSteps, 'junit-report', 'reports/junit.xml');

      const audit = workflow.jobs?.audit;
      if (!audit) {
        assert.fail('workflow.jobs.audit must exist');
      }

      const auditSteps = audit.steps;
      assertStepArray(auditSteps, 'workflow.jobs.audit.steps must be an array');
      const auditRunLines = extractRunLines(auditSteps);

      assertCommandPresence(
        auditRunLines,
        'pnpm audit --audit-level=moderate',
        'audit job must run pnpm audit with moderate threshold',
      );

      assertLineIncludes(
        auditRunLines,
        'osv-scanner',
        'audit job must run osv-scanner',
      );

      const auditArtifactSteps = auditSteps.filter(isUploadArtifactStep);
      assertArtifactStep(auditArtifactSteps, 'audit-report', 'audit-report.json');

      const build = workflow.jobs?.build;
      if (!build) {
        assert.fail('workflow.jobs.build must exist');
      }

      assertJobNeedsInclude(
        build.needs,
        'audit',
        'build job must depend on audit job',
      );
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
    assert.fail(`workflow must upload artifact named "${expectedName}"`);
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

function extractRunLines(steps: StepConfig[]): string[] {
  return steps.flatMap((step) => {
    if (typeof step.run !== 'string') {
      return [];
    }

    return step.run
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
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

function assertStepWithName(
  steps: StepConfig[],
  expectedName: string,
  message: string,
): StepConfig {
  const match = steps.find(
    (step) => typeof step.name === 'string' && step.name.trim() === expectedName,
  );

  if (!match) {
    assert.fail(message);
  }

  return match;
}

function assertStepIfEquals(step: StepConfig, expected: string, message: string): void {
  if (typeof step.if !== 'string') {
    assert.fail(`${message}; step.if must be configured as a string`);
  }

  assert.strictEqual(step.if.trim(), expected, message);
}

function assertStepRunIncludesLine(step: StepConfig, expectedLine: string, message: string): void {
  if (typeof step.run !== 'string') {
    assert.fail(`${message}; step.run must be configured as a string`);
  }

  const lines = step.run
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const index = lines.findIndex((line) => line === expectedLine);

  assert.notStrictEqual(index, -1, message);
}

function assertRunScriptHasPrecedingLine(
  steps: StepConfig[],
  targetLine: string,
  precedingLine: string,
  message: string,
): void {
  const script = steps.find((step) => typeof step.run === 'string' && step.run.includes(targetLine))?.run;

  if (typeof script !== 'string') {
    assert.fail(`${message}; run script containing "${targetLine}" not found`);
  }

  const lines = script
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const targetIndex = lines.findIndex((line) => line === targetLine);

  if (targetIndex === -1) {
    assert.fail(`${message}; run script must include exact line "${targetLine}"`);
  }

  const precedingIndex = lines.findIndex(
    (line, index) => index < targetIndex && line === precedingLine,
  );

  assert.notStrictEqual(precedingIndex, -1, message);
}

function assertJobNeedsInclude(
  value: JobNeedsConfig,
  expected: string,
  message: string,
): void {
  if (typeof value === 'string') {
    assert.strictEqual(value, expected, message);
    return;
  }

  if (Array.isArray(value)) {
    const hasMatch = value.some((entry) => entry === expected);
    assert.ok(hasMatch, message);
    return;
  }

  assert.fail(`${message}; needs must be configured as a string or array of strings`);
}

function assertLineIncludes(lines: string[], expected: string, message: string): void {
  const index = lines.findIndex((line) => line.includes(expected));

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
