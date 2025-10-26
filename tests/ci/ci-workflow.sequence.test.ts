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
    reports?: ReportsJobConfig;
    build?: BuildJobConfig;
  };
};

type AuditJobConfig = {
  steps?: StepConfig[];
};

type ReportsJobConfig = {
  needs?: JobNeedsConfig;
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
  'continue-on-error'?: unknown;
};

type UploadArtifactStep = StepConfig & {
  uses: string;
  with?: {
    name?: unknown;
    path?: unknown;
    'if-no-files-found'?: unknown;
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
  'pnpm test -- --test-reporter junit --test-reporter-destination=file=reports/junit.xml';

const { load } = await importJsYaml();

describe('ci workflow build job', () => {
  test('runs recommended pnpm commands for autosave and reports', async () => {
    try {
      const workflow = await readWorkflowYaml();
      const quality = workflow.jobs?.quality;
      if (!quality) {
        assert.fail('workflow.jobs.quality must exist');
      }

      const matrixEntries = quality.strategy?.matrix?.include;
      assertMatrixEntries(matrixEntries, 'quality job must configure matrix.include array');

      const qualityCommands = extractMatrixCommands(matrixEntries);

      const qualitySteps = quality.steps;
      assertStepArray(qualitySteps, 'workflow.jobs.quality.steps must be an array');

      const runSuiteStep = assertStepWithName(
        qualitySteps,
        'Run ${{ matrix.suite }} suite',
        'quality job must include "Run ${{ matrix.suite }} suite" step',
      );

      assertStepContinueOnError(runSuiteStep, '"Run ${{ matrix.suite }} suite" step must enable continue-on-error');

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

      assertJobNeedsIncludeAll(
        reports.needs,
        ['quality'],
        'reports job must depend on quality job',
      );

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

      assertJunitCommand(
        reportCommands,
        expectedJunitCommand,
        'reports job must generate JUnit report',
      );

      const artifactSteps = reportSteps.filter(isUploadArtifactStep);

      assertArtifactStep(artifactSteps, 'coverage', 'coverage/', 'error', 'always()');
      assertArtifactStep(
        artifactSteps,
        'junit-report',
        'reports/junit.xml',
        'error',
        'always()',
      );

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
        'raw.githubusercontent.com/google/osv-scanner/main/scripts/install.sh',
        'audit job must install osv-scanner via official install script',
      );

      assertLineIncludes(
        auditRunLines,
        'osv-scanner',
        'audit job must run osv-scanner',
      );

      const auditArtifactSteps = auditSteps.filter(isUploadArtifactStep);
      assertArtifactStep(
        auditArtifactSteps,
        'audit-report',
        'audit-report.json',
        'error',
        'always()',
      );

      const build = workflow.jobs?.build;
      if (!build) {
        assert.fail('workflow.jobs.build must exist');
      }

      assertJobNeedsIncludeAll(
        build.needs,
        ['sbom', 'license', 'quality', 'audit'],
        'build job must depend on sbom, license, quality, and audit jobs',
      );
    } catch (error) {
      console.error('CI workflow verification failed:', error);
      throw error;
    }
  });

  test('uploads suite logs artifact on quality job matrix runs', async () => {
    const workflow = await readWorkflowYaml();
    const quality = workflow.jobs?.quality;
    if (!quality) {
      assert.fail('workflow.jobs.quality must exist');
    }

    const steps = quality.steps;
    assertStepArray(steps, 'workflow.jobs.quality.steps must be an array');

    const uploadLogsStep = assertStepWithName(
      steps,
      'Upload suite logs',
      'quality job must include "Upload suite logs" step',
    );

    if (!isUploadArtifactStep(uploadLogsStep)) {
      assert.fail('"Upload suite logs" step must upload an artifact');
    }

    assertStepUsesEquals(
      uploadLogsStep,
      'actions/upload-artifact@v4',
      '"Upload suite logs" step must use actions/upload-artifact@v4',
    );

    assertStepIfEquals(
      uploadLogsStep,
      'always()',
      '"Upload suite logs" step must run on all outcomes',
    );

    assertUploadArtifactName(
      uploadLogsStep,
      'quality-${{ matrix.suite }}',
      '"Upload suite logs" artifact must be named "quality-${{ matrix.suite }}"',
    );

    assertUploadArtifactPaths(
      uploadLogsStep,
      [
        'logs/${{ matrix.suite }}.log',
        'logs/${{ matrix.suite }}-failures.log',
      ],
      '"Upload suite logs" artifact must include suite and failure logs',
    );
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
  expectedIfNoFilesFound?: string,
  expectedIf?: string,
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

  if (expectedIfNoFilesFound !== undefined) {
    const { 'if-no-files-found': ifNoFilesFound } = config;
    if (typeof ifNoFilesFound !== 'string') {
      assert.fail(
        `artifact "${expectedName}" must configure if-no-files-found as a string`,
      );
    }

    assert.strictEqual(
      ifNoFilesFound.trim(),
      expectedIfNoFilesFound,
      `artifact "${expectedName}" must set if-no-files-found to "${expectedIfNoFilesFound}"`,
    );
  }

  if (expectedIf !== undefined) {
    if (typeof match.if !== 'string') {
      assert.fail(`artifact "${expectedName}" must configure if as a string`);
    }

    assert.strictEqual(
      match.if.trim(),
      expectedIf,
      `artifact "${expectedName}" must set if to "${expectedIf}"`,
    );
  }
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

function assertJunitCommand(
  commands: string[],
  expected: string,
  message: string,
): void {
  if (commands.includes(expected)) {
    return;
  }

  assert.fail(`${message}\n\n${formatCommandDiff(commands, expected)}`);
}

function formatCommandDiff(commands: string[], expected: string): string {
  const pnpmTestCommands = commands.filter((command) => command.startsWith('pnpm test'));

  if (pnpmTestCommands.length === 0) {
    return `expected command:\n  ${expected}\nno pnpm test command found in workflow`;
  }

  const closest = pnpmTestCommands.reduce((best, candidate) =>
    prefixScore(candidate, expected) >= prefixScore(best, expected) ? candidate : best,
  );

  return [
    'expected command:',
    `  ${expected}`,
    'closest actual command:',
    `  ${highlightTokenDiff(closest, expected)}`,
  ].join('\n');
}

function highlightTokenDiff(actual: string, expected: string): string {
  const red = (value: string) => `\u001B[31m${value}\u001B[0m`;
  const actualTokens = actual.split(/\s+/u).filter(Boolean);
  const expectedTokens = expected.split(/\s+/u).filter(Boolean);
  const maxLength = Math.max(actualTokens.length, expectedTokens.length);
  const highlighted: string[] = [];

  for (let index = 0; index < maxLength; index += 1) {
    const actualToken = actualTokens[index];
    const expectedToken = expectedTokens[index];

    if (actualToken === expectedToken) {
      highlighted.push(actualToken ?? red('<missing>'));
      continue;
    }

    highlighted.push(
      actualToken === undefined ? red('<missing>') : red(actualToken),
    );
  }

  return highlighted.join(' ');
}

function prefixScore(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;

  while (index < limit && left[index] === right[index]) {
    index += 1;
  }

  return index;
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

function assertStepUsesEquals(step: StepConfig, expected: string, message: string): void {
  if (typeof step.uses !== 'string') {
    assert.fail(`${message}; step.uses must be configured as a string`);
  }

  assert.strictEqual(step.uses.trim(), expected, message);
}

function assertStepIfEquals(step: StepConfig, expected: string, message: string): void {
  if (typeof step.if !== 'string') {
    assert.fail(`${message}; step.if must be configured as a string`);
  }

  assert.strictEqual(step.if.trim(), expected, message);
}

function assertStepContinueOnError(step: StepConfig, message: string): void {
  const value = step['continue-on-error'];

  if (typeof value !== 'boolean') {
    assert.fail(`${message}; step.continue-on-error must be configured as a boolean`);
  }

  assert.strictEqual(value, true, message);
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

function assertJobNeedsIncludeAll(
  value: JobNeedsConfig,
  expected: string[],
  message: string,
): void {
  const needs = normalizeJobNeeds(value);

  for (const dependency of expected) {
    const hasMatch = needs.includes(dependency);
    assert.ok(hasMatch, `${message}; needs must include "${dependency}"`);
  }
}

function normalizeJobNeeds(value: JobNeedsConfig): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value;
  }

  assert.fail('build job must configure needs as a string or array of strings');
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

function assertUploadArtifactPaths(
  step: UploadArtifactStep,
  expectedPaths: string[],
  message: string,
): void {
  const config = step.with;
  if (!config || typeof config !== 'object') {
    assert.fail(`${message}; step.with must be configured`);
  }

  const { path } = config as { path?: unknown };
  if (typeof path !== 'string') {
    assert.fail(`${message}; path must be configured as a multi-line string`);
  }

  const configuredPaths = path
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const expectedPath of expectedPaths) {
    const hasMatch = configuredPaths.includes(expectedPath);
    assert.ok(hasMatch, `${message}; path must include "${expectedPath}"`);
  }
}

function assertUploadArtifactName(
  step: UploadArtifactStep,
  expectedName: string,
  message: string,
): void {
  const config = step.with;
  if (!config || typeof config !== 'object') {
    assert.fail(`${message}; step.with must be configured`);
  }

  const { name } = config as { name?: unknown };
  if (typeof name !== 'string') {
    assert.fail(`${message}; name must be configured as a string`);
  }

  assert.strictEqual(name.trim(), expectedName, message);
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

async function readWorkflowYaml(): Promise<WorkflowYaml> {
  const source = await readFile(workflowPath, 'utf8');
  const parsed = load(source) as unknown;

  if (!parsed || typeof parsed !== 'object') {
    assert.fail('workflow must parse to an object');
  }

  return parsed as WorkflowYaml;
}

type NodeError = Error & {
  code?: string;
};

function isNodeError(error: unknown): error is NodeError {
  return error instanceof Error && 'code' in error;
}
