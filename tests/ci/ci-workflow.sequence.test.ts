/// <reference types="node" />

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importJsYaml, loadWorkflow } from './utils/workflow-loader.js';

import { loadTestStrategyExpectations } from './test-strategy-autosave-merge.ts';

type WorkflowYaml = {
  jobs?: {
    quality?: QualityJobConfig;
    audit?: AuditJobConfig;
    reports?: ReportsJobConfig;
    build?: BuildJobConfig;
  };
};

type AuditJobConfig = {
  needs?: JobNeedsConfig;
  steps?: StepConfig[];
};

type ReportsJobConfig = {
  needs?: JobNeedsConfig;
  steps?: StepConfig[];
};

type BuildJobConfig = {
  needs?: JobNeedsConfig;
};

type QualityJobStrategyConfig = {
  'fail-fast'?: boolean | string | undefined;
  matrix?: {
    include?: QualityMatrixEntry[];
  };
};

type QualityJobConfig = {
  needs?: JobNeedsConfig;
  strategy?: QualityJobStrategyConfig;
  steps?: StepConfig[];
};

type QualityMatrixEntry = {
  command?: unknown;
  suite?: unknown;
  collect_failures?: unknown;
};

type JobNeedsConfig = string | string[] | undefined;

type StepConfig = {
  run?: unknown;
  uses?: unknown;
  with?: unknown;
  name?: unknown;
  id?: unknown;
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

type PathsFilterStep = StepConfig & {
  with?: {
    filters?: unknown;
  };
};

type JsYamlModule = {
  load: (input: string) => unknown;
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '..', '..');
const workflowPath = resolve(repoRoot, '.github', 'workflows', 'ci.yml');
const testStrategyPath = resolve(repoRoot, 'tests', 'TEST_STRATEGY_AUTOSAVE_MERGE.md');
const require = createRequire(import.meta.url);
const autosaveSuffixModuleGlobs = [
  'src/**/*autosave*.ts',
  'src/**/*autosave*.tsx',
  'src/**/*[Aa]uto[Ss]ave*.ts',
  'src/**/*[Aa]uto[Ss]ave*.tsx',
] as const satisfies readonly string[];

const autosaveSuffixTestGlobs = [
  'tests/**/*autosave*.test.ts',
  'tests/**/*autosave*.spec.ts',
] as const;

const autosaveSuffixTsxTestGlobs = [
  'tests/**/*autosave*.test.tsx',
  'tests/**/*autosave*.spec.tsx',
] as const;

const autosaveTsxTestGlobs = [
  'tests/**/*[Aa]uto[Ss]ave*.test.tsx',
  'tests/**/*[Aa]uto[Ss]ave*.spec.tsx',
] as const satisfies readonly string[];
const vscodeFlagsHandshakeSpecPath = 'tests/extensions/vscode/flags-handshake.spec.ts';

const requiredAutosaveFilterGlobs = [
  'src/**/autosave/**',
  ...autosaveSuffixModuleGlobs,
  'tests/**/autosave.*.test.ts',
  'tests/**/autosave/**',
  '.github/workflows/autosave*',
  ...autosaveSuffixTestGlobs,
  ...autosaveSuffixTsxTestGlobs,
  ...autosaveTsxTestGlobs,
  vscodeFlagsHandshakeSpecPath,
];

const expectedRunSuiteStepIds = ['run_suite_autosave', 'run_suite_default'] as const;

const {
  qualityCommands: expectedQualitySequence,
  qualitySuites: expectedQualitySuites,
  coverageCleanup: expectedCoverageCleanup,
  coverageCommand: expectedCoverageCommand,
  junitCommand: expectedJunitCommand,
} = await loadTestStrategyExpectations(testStrategyPath);
const expectedSuiteFailureChecks = [
  "steps.run_suite_autosave.outcome == 'failure'",
  "steps.run_suite_default.outcome == 'failure'",
];
const expectedAuditReportRedirection =
  'pnpm audit --audit-level=moderate --json > audit-report.json';
const expectedOsvReportOutputFlag = '--output osv-report.json';
const expectedOsvPackageSpecifier = '@google/osv-scanner@1.7.3';
const expectedOsvDlxPrefix = `pnpm dlx --package=${expectedOsvPackageSpecifier}`;
const expectedPnpmAuditStepId = 'pnpm_audit';
const expectedPnpmAuditExitCodeExport = 'echo "exit_code=$status" >> "$GITHUB_OUTPUT"';
const expectedAuditFailureStepName = 'Fail when pnpm audit reports vulnerabilities';
const expectedAuditFailureCondition = "steps.pnpm_audit.outputs.exit_code != '0'";
const expectedAuditFailureExitCommand = 'exit "${{ steps.pnpm_audit.outputs.exit_code }}"';
const expectedPnpmAuditRunLines = [
  'set -euo pipefail',
  'set +e',
  expectedAuditReportRedirection,
  'status=$?',
  'set -e',
  expectedPnpmAuditExitCodeExport,
];

const { load } = await importJsYaml();

describe('ci workflow build job', () => {
  test('test strategy documents coverage cleanup and junit commands', () => {
    assert.ok(
      expectedCoverageCleanup,
      'Test strategy 4.1 (step 7) must document coverage cleanup command before reports job execution',
    );
    assert.match(
      expectedCoverageCleanup,
      /rm\s+-rf\s+coverage/u,
      'Test strategy 4.1 (step 7) must instruct removing coverage directory',
    );
    assert.ok(
      expectedCoverageCommand,
      'Test strategy 4.1 (step 7) must document coverage command',
    );
    assert.match(
      expectedCoverageCommand,
      /test:coverage/u,
      'Test strategy 4.1 (step 7) coverage command must target test:coverage suite',
    );
    assert.ok(
      expectedJunitCommand,
      'Test strategy 4.1 (step 7) must document JUnit command',
    );
    assert.match(
      expectedJunitCommand,
      /--test-reporter=junit/u,
      'Test strategy 4.1 (step 7) must configure JUnit reporter output',
    );
  });

  test('quality job configures expected suites', async () => {
    const workflow = await readWorkflowYaml();
    const quality = workflow.jobs?.quality;
    if (!quality) {
      assert.fail('workflow.jobs.quality must exist');
    }

    const matrixEntries = quality.strategy?.matrix?.include;
    assertMatrixEntries(matrixEntries, 'quality job must configure matrix.include array');

    const suites = extractMatrixSuites(matrixEntries);

    assertCommandSequence(
      suites,
      expectedQualitySuites,
      'quality job matrix.include suites',
      { exact: true },
    );
  });

  test('quality job depends on sbom job', async () => {
    const workflow = await readWorkflowYaml();
    const quality = workflow.jobs?.quality;
    if (!quality) {
      assert.fail('workflow.jobs.quality must exist');
    }

    assertJobNeedsIncludeAll(quality.needs, ['sbom'], 'quality job must depend on sbom job');
  });

  test('quality job configures collect_failures per suite', async () => {
    const workflow = await readWorkflowYaml();
    const quality = workflow.jobs?.quality;
    if (!quality) {
      assert.fail('workflow.jobs.quality must exist');
    }

    const matrixEntries = quality.strategy?.matrix?.include;
    assertMatrixEntries(matrixEntries, 'quality job must configure matrix.include array');

    const expectedCollectFailures: Record<string, boolean> = {
      lint: false,
      typecheck: false,
      autosave: true,
      merge: true,
      cli: true,
      collector: true,
      telemetry: true,
    };

    for (const entry of matrixEntries) {
      const { suite, collect_failures: collectFailures } = entry;

      if (typeof suite !== 'string') {
        assert.fail('quality job matrix.include suites must be configured as strings');
      }

      const suiteName = suite.trim();
      const expectedValue = expectedCollectFailures[suiteName];

      if (expectedValue === undefined) {
        assert.fail(
          `quality job matrix.include must configure collect_failures expectations for suite "${suiteName}"`,
        );
      }

      if (typeof collectFailures !== 'boolean') {
        assert.fail(
          `quality job matrix.include entry for suite "${suiteName}" must configure collect_failures as a boolean`,
        );
      }

      assert.strictEqual(
        collectFailures,
        expectedValue,
        `quality job matrix.include entry for suite "${suiteName}" must ${expectedValue ? 'enable' : 'disable'} collect_failures`,
      );
    }
  });

  test('autosave paths filter monitors required globs', async () => {
    const workflow = await readWorkflowYaml();
    const quality = workflow.jobs?.quality;
    if (!quality) {
      assert.fail('workflow.jobs.quality must exist');
    }

    const steps = quality.steps;
    assertStepArray(steps, 'workflow.jobs.quality.steps must be an array');

    const detectAutosaveChanges = assertDetectAutosaveChangesStep(
      steps,
      'quality job must include "Detect autosave changes" step for autosave suite',
    );

    assertPathsFilterGlobs(
      detectAutosaveChanges,
      'autosave',
      requiredAutosaveFilterGlobs,
      '"Detect autosave changes" step must monitor required autosave paths',
    );
  });

  test('autosave paths filter monitors autosave suffix modules', async () => {
    const workflow = await readWorkflowYaml();
    const quality = workflow.jobs?.quality;
    if (!quality) {
      assert.fail('workflow.jobs.quality must exist');
    }

    const steps = quality.steps;
    assertStepArray(steps, 'workflow.jobs.quality.steps must be an array');

    const detectAutosaveChanges = assertDetectAutosaveChangesStep(
      steps,
      'quality job must include "Detect autosave changes" step for autosave suite',
    );

    const globs = getPathsFilterGlobs(
      detectAutosaveChanges,
      'autosave',
      '"Detect autosave changes" step must configure autosave filters',
    );

    for (const glob of autosaveSuffixModuleGlobs) {
      assert(
        globs.includes(glob),
        `"Detect autosave changes" filters.autosave must monitor autosave-suffixed modules via glob "${glob}"`,
      );
    }
  });

  test('autosave paths filter includes autosave suffix module globs exactly once', async () => {
    const workflow = await readWorkflowYaml();
    const quality = workflow.jobs?.quality;
    if (!quality) {
      assert.fail('workflow.jobs.quality must exist');
    }

    const steps = quality.steps;
    assertStepArray(steps, 'workflow.jobs.quality.steps must be an array');

    const detectAutosaveChanges = assertDetectAutosaveChangesStep(
      steps,
      'quality job must include "Detect autosave changes" step for autosave suite',
    );

    const globs = getPathsFilterGlobs(
      detectAutosaveChanges,
      'autosave',
      '"Detect autosave changes" step must configure autosave filters',
    );

    for (const glob of autosaveSuffixModuleGlobs) {
      const occurrences = globs.filter((entry) => entry === glob).length;
      assert.strictEqual(
        occurrences,
        1,
        `"Detect autosave changes" filters.autosave must include glob "${glob}" exactly once`,
      );
    }
  });

  test('autosave paths filter monitors suffix-based autosave tests', async () => {
    const workflow = await readWorkflowYaml();
    const quality = workflow.jobs?.quality;
    if (!quality) {
      assert.fail('workflow.jobs.quality must exist');
    }

    const steps = quality.steps;
    assertStepArray(steps, 'workflow.jobs.quality.steps must be an array');

    const detectAutosaveChanges = assertDetectAutosaveChangesStep(
      steps,
      'quality job must include "Detect autosave changes" step for autosave suite',
    );

    const globs = getPathsFilterGlobs(
      detectAutosaveChanges,
      'autosave',
      '"Detect autosave changes" step must configure autosave filters',
    );

    for (const glob of autosaveSuffixTestGlobs) {
      assert(
        globs.includes(glob),
        `"Detect autosave changes" filters.autosave must monitor suffix-based autosave tests via glob "${glob}"`,
      );
    }

    for (const glob of autosaveSuffixTsxTestGlobs) {
      assert(
        globs.includes(glob),
        `"Detect autosave changes" filters.autosave must monitor TSX autosave tests via glob "${glob}"`,
      );
    }

    for (const glob of autosaveTsxTestGlobs) {
      assert(
        globs.includes(glob),
        `"Detect autosave changes" filters.autosave must monitor suffix-based autosave TSX tests via glob "${glob}"`,
      );
    }
  });

  test('autosave paths filter monitors VS Code handshake spec', async () => {
    const workflow = await readWorkflowYaml();
    const quality = workflow.jobs?.quality;
    if (!quality) {
      assert.fail('workflow.jobs.quality must exist');
    }

    const steps = quality.steps;
    assertStepArray(steps, 'workflow.jobs.quality.steps must be an array');

    const detectAutosaveChanges = assertDetectAutosaveChangesStep(
      steps,
      'quality job must include "Detect autosave changes" step for autosave suite',
    );

    const globs = getPathsFilterGlobs(
      detectAutosaveChanges,
      'autosave',
      '"Detect autosave changes" step must configure autosave filters',
    );

    assert(
      globs.includes(vscodeFlagsHandshakeSpecPath),
      '"Detect autosave changes" filters.autosave must monitor VS Code handshake spec',
    );
  });

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
      const qualitySuites = extractMatrixSuites(matrixEntries);

      assert.strictEqual(
        qualitySuites.length,
        expectedQualitySuites.length,
        'quality job matrix.include must configure expected suites',
      );

      assertCommandSequence(
        qualitySuites,
        expectedQualitySuites,
        'quality job matrix.include suites',
      );

      assertQualityStrategyFailFastDisabled(
        quality.strategy,
        'quality job must disable fail-fast to collect all suite failures',
      );

      const qualitySteps = quality.steps;
      assertStepArray(qualitySteps, 'workflow.jobs.quality.steps must be an array');

      const { autosave: runSuiteAutosave, default: runSuiteDefault } = assertRunSuiteSteps(
        qualitySteps,
        'quality job must include "Run ${{ matrix.suite }} suite" steps for autosave and default suites',
      );

      assertStepContinueOnError(
        runSuiteAutosave,
        '"Run ${{ matrix.suite }} suite" autosave step must enable continue-on-error',
      );
      assertStepContinueOnError(
        runSuiteDefault,
        '"Run ${{ matrix.suite }} suite" default step must enable continue-on-error',
      );

      const reportFailureStep = assertStepWithName(
        qualitySteps,
        'Report suite failure',
        'quality job must include "Report suite failure" step',
      );

      assertSuiteFailureCondition(
        reportFailureStep,
        { failureChecks: expectedSuiteFailureChecks },
        '"Report suite failure" step must run only when any run suite step fails',
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

  test('quality job prepares failure log files before running suites', async () => {
    const workflow = await readWorkflowYaml();
    const quality = workflow.jobs?.quality;
    if (!quality) {
      assert.fail('workflow.jobs.quality must exist');
    }

    const steps = quality.steps;
    assertStepArray(steps, 'workflow.jobs.quality.steps must be an array');

    const { autosave: runSuiteAutosave, default: runSuiteDefault } = assertRunSuiteSteps(
      steps,
      'quality job must include "Run ${{ matrix.suite }} suite" steps for autosave and default suites',
    );

    const failureLogInit = ': > "logs/${{ matrix.suite }}-failures.log"';
    const suiteCommand = '${{ matrix.command }} |& tee "logs/${{ matrix.suite }}.log"';

    assertStepRunIncludesLine(
      runSuiteAutosave,
      failureLogInit,
      'autosave suite execution must pre-create failure log before running tests',
    );

    assertStepRunIncludesLine(
      runSuiteDefault,
      failureLogInit,
      'non-autosave suites (including collect_failures: false) must pre-create failure log before running tests',
    );

    assertRunScriptHasPrecedingLine(
      [runSuiteAutosave],
      suiteCommand,
      failureLogInit,
      'autosave suite execution must initialize failure log prior to invoking the suite command',
    );

    assertRunScriptHasPrecedingLine(
      [runSuiteDefault],
      suiteCommand,
      failureLogInit,
      'non-autosave suite execution must initialize failure log prior to invoking the suite command',
    );
  });

  test('quality job disables matrix fail-fast', async () => {
    const workflow = await readWorkflowYaml();
    const quality = workflow.jobs?.quality;
    if (!quality) {
      assert.fail('workflow.jobs.quality must exist');
    }

    const strategy = quality.strategy;
    if (!strategy || typeof strategy !== 'object') {
      assert.fail('workflow.jobs.quality.strategy must be defined as an object');
    }

    assert.strictEqual(
      strategy['fail-fast'],
      false,
      'quality job strategy.fail-fast must be explicitly set to false',
    );
  });

  test('audit job generates separate artifacts for pnpm audit and osv scanner reports', async () => {
    const workflow = await readWorkflowYaml();
    const audit = workflow.jobs?.audit;
    if (!audit) {
      assert.fail('workflow.jobs.audit must exist');
    }

    assertJobNeedsIncludeAll(
      audit.needs,
      ['sbom'],
      'audit job must depend on sbom job',
    );

    const auditSteps = audit.steps;
    assertStepArray(auditSteps, 'workflow.jobs.audit.steps must be an array');
    const auditRunLines = extractRunLines(auditSteps);

    assertLineIncludes(
      auditRunLines,
      expectedAuditReportRedirection,
      'audit job must run pnpm audit with JSON output redirected to audit-report.json',
    );

    assertLineIncludes(
      auditRunLines,
      expectedOsvDlxPrefix,
      'audit job must install osv-scanner via pnpm dlx with a pinned version',
    );

    assert.ok(
      auditRunLines.every((line) => !line.includes('curl ')),
      'audit job must not rely on curl-based installers for osv-scanner',
    );

    assertLineIncludes(
      auditRunLines,
      'osv-scanner',
      'audit job must run osv-scanner',
    );
    assertLineIncludes(
      auditRunLines,
      expectedOsvReportOutputFlag,
      'audit job must configure osv-scanner to write report to osv-report.json',
    );

    const auditArtifactSteps = auditSteps.filter(isUploadArtifactStep);
    assertArtifactStep(
      auditArtifactSteps,
      'audit-report',
      'audit-report.json',
      'error',
      'always()',
    );
    assertArtifactStep(
      auditArtifactSteps,
      'osv-report',
      'osv-report.json',
      'warn',
      'always()',
    );
  });

  test('audit job preserves pnpm audit exit code for downstream failure gating', async () => {
    const workflow = await readWorkflowYaml();
    const audit = workflow.jobs?.audit;
    if (!audit) {
      assert.fail('workflow.jobs.audit must exist');
    }

    const steps = audit.steps;
    assertStepArray(steps, 'workflow.jobs.audit.steps must be an array');

    const pnpmAuditStep = assertStepWithNameAndId(
      steps,
      'Run pnpm audit',
      expectedPnpmAuditStepId,
      'audit job must configure pnpm audit step with deterministic id',
    );

    assertStepRunIncludesLine(
      pnpmAuditStep,
      'set +e',
      'audit job pnpm audit step must disable errexit to capture exit code',
    );
    assertStepRunIncludesLine(
      pnpmAuditStep,
      'status=$?',
      'audit job pnpm audit step must capture pnpm audit exit status',
    );
    assertStepRunIncludesLine(
      pnpmAuditStep,
      expectedPnpmAuditExitCodeExport,
      'audit job pnpm audit step must export pnpm audit exit code for downstream steps',
    );

    const osvScannerStep = assertStepWithName(
      steps,
      'Run osv-scanner',
      'audit job must run osv-scanner',
    );

    assertStepRunIncludesLine(
      osvScannerStep,
      expectedOsvDlxPrefix,
      'audit job must run osv-scanner via pnpm dlx with a pinned version',
    );

    const failureStep = assertStepWithName(
      steps,
      expectedAuditFailureStepName,
      'audit job must terminate when pnpm audit reports vulnerabilities',
    );

    assertStepIfEquals(
      failureStep,
      expectedAuditFailureCondition,
      'audit job failure step must depend on pnpm audit exit code output',
    );
    assertStepRunIncludesLine(
      failureStep,
      expectedAuditFailureExitCommand,
      'audit job failure step must exit using the pnpm audit exit code when vulnerabilities are found',
    );

    const pnpmAuditIndex = steps.indexOf(pnpmAuditStep);
    const osvScannerIndex = steps.indexOf(osvScannerStep);
    const failureIndex = steps.indexOf(failureStep);

    assert.ok(
      pnpmAuditIndex > -1 && osvScannerIndex > pnpmAuditIndex,
      'audit job must run osv-scanner after pnpm audit step',
    );
    assert.ok(
      failureIndex > osvScannerIndex,
      'audit job failure step must run after osv-scanner to ensure reports are generated first',
    );
  });

  test('audit job defers pnpm audit failure until after osv-scanner completes', async () => {
    const workflow = await readWorkflowYaml();
    const audit = workflow.jobs?.audit;
    if (!audit) {
      assert.fail('workflow.jobs.audit must exist');
    }

    const steps = audit.steps;
    assertStepArray(steps, 'workflow.jobs.audit.steps must be an array');

    const pnpmAuditStep = assertStepWithNameAndId(
      steps,
      'Run pnpm audit',
      expectedPnpmAuditStepId,
      'audit job must configure pnpm audit step with deterministic id',
    );

    const osvScannerStep = assertStepWithName(
      steps,
      'Run osv-scanner',
      'audit job must run osv-scanner',
    );

    const failureStep = assertStepWithName(
      steps,
      expectedAuditFailureStepName,
      'audit job must terminate when pnpm audit reports vulnerabilities',
    );

    const pnpmAuditRunLines = extractRunLines([pnpmAuditStep]);
    assert.deepStrictEqual(
      pnpmAuditRunLines,
      expectedPnpmAuditRunLines,
      'audit job pnpm audit step must preserve exit code while producing audit-report.json',
    );

    assertStepRunIncludesLine(
      osvScannerStep,
      expectedOsvReportOutputFlag,
      'audit job must write osv-scanner results to osv-report.json',
    );

    assertStepRunIncludesLine(
      failureStep,
      expectedAuditFailureExitCommand,
      'audit job failure step must exit using preserved pnpm audit exit code',
    );

    const pnpmAuditIndex = steps.indexOf(pnpmAuditStep);
    const osvScannerIndex = steps.indexOf(osvScannerStep);
    const failureIndex = steps.indexOf(failureStep);

    assert.ok(
      pnpmAuditIndex > -1 && pnpmAuditIndex < osvScannerIndex,
      'audit job must run osv-scanner after pnpm audit collects exit code',
    );
    assert.ok(
      osvScannerIndex < failureIndex,
      'audit job failure step must run after osv-scanner completes',
    );
  });

  test('quality job run steps expose deterministic ids for downstream steps', async () => {
    const workflow = await readWorkflowYaml();
    const quality = workflow.jobs?.quality;
    if (!quality) {
      assert.fail('workflow.jobs.quality must exist');
    }

    const steps = quality.steps;
    assertStepArray(steps, 'workflow.jobs.quality.steps must be an array');

    const runSuiteSteps = assertRunSuiteStepCollection(
      steps,
      'quality job must include "Run ${{ matrix.suite }} suite" steps',
    );

    const runSuiteStepList = expectedRunSuiteStepIds.map((id) => runSuiteSteps[id]);

    assertStepIdEquals(
      runSuiteStepList,
      [...expectedRunSuiteStepIds],
      'run suite steps must expose deterministic ids for downstream conditionals',
    );
  });

  test('quality job run steps configure logging, command execution, and continue-on-error', async () => {
    const workflow = await readWorkflowYaml();
    const quality = workflow.jobs?.quality;
    if (!quality) {
      assert.fail('workflow.jobs.quality must exist');
    }

    const steps = quality.steps;
    assertStepArray(steps, 'workflow.jobs.quality.steps must be an array');

    const runSuiteSteps = assertRunSuiteStepCollection(
      steps,
      'quality job must include "Run ${{ matrix.suite }} suite" steps',
    );

    for (const expectedId of expectedRunSuiteStepIds) {
      const runSuiteStep = runSuiteSteps[expectedId];
      assertStepContinueOnError(
        runSuiteStep,
        `run suite ${expectedId} step must enable continue-on-error`,
      );
      assertStepRunIncludesLine(
        runSuiteStep,
        'mkdir -p logs',
        `run suite ${expectedId} step must create logs directory`,
      );
      assertStepRunIncludesLine(
        runSuiteStep,
        ': > "logs/${{ matrix.suite }}-failures.log"',
        `run suite ${expectedId} step must create empty failure log placeholder`,
      );
      assertStepRunIncludesLine(
        runSuiteStep,
        'tee "logs/${{ matrix.suite }}.log"',
        `run suite ${expectedId} step must tee suite output into logs/\${{ matrix.suite }}.log`,
      );
      assertStepRunIncludesLine(
        runSuiteStep,
        '${{ matrix.command }}',
        `run suite ${expectedId} step must execute \${{ matrix.command }}`,
      );
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
      [
        'always() &&',
        '(',
        "  steps.run_suite_autosave.outcome != 'skipped' ||",
        "  steps.run_suite_default.outcome != 'skipped'",
        ')',
      ].join('\n'),
      '"Upload suite logs" step must run only when any run suite step executes',
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

    assertUploadArtifactIfNoFilesFoundEquals(
      uploadLogsStep,
      'error',
      '"Upload suite logs" artifact must fail when logs are missing',
    );
  });

  test('extracts failed suite output when collection is enabled', async () => {
    const workflow = await readWorkflowYaml();
    const quality = workflow.jobs?.quality;
    if (!quality) {
      assert.fail('workflow.jobs.quality must exist');
    }

    const steps = quality.steps;
    assertStepArray(steps, 'workflow.jobs.quality.steps must be an array');

    const extractFailuresStep = assertStepWithName(
      steps,
      'Extract failed test output',
      'quality job must include "Extract failed test output" step',
    );

    assertSuiteFailureCondition(
      extractFailuresStep,
      {
        prerequisites: ['matrix.collect_failures'],
        failureChecks: expectedSuiteFailureChecks,
      },
      '"Extract failed test output" step must run only when suite fails and collection is enabled',
    );

    assertStepRunIncludesLine(
      extractFailuresStep,
      "grep -E ':[0-9]+:[0-9]+: |not ok|FAIL|Error' \"logs/${{ matrix.suite }}.log\" > \"logs/${{ matrix.suite }}-failures.log\" || true",
      '"Extract failed test output" step must capture failed test output with grep while tolerating missing matches',
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

function assertQualityStrategyFailFastDisabled(
  strategy: QualityJobConfig['strategy'],
  message: string,
): void {
  if (!strategy || typeof strategy !== 'object') {
    assert.fail(message);
  }

  const failFast = strategy['fail-fast'];

  if (typeof failFast !== 'boolean') {
    assert.fail(`${message}: fail-fast must be a boolean`);
  }

  assert.strictEqual(
    failFast,
    false,
    `${message}: expected fail-fast to be explicitly set to false`,
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

type CommandSequenceOptions = {
  exact?: boolean;
};

function assertCommandSequence(
  commands: string[],
  expected: string[],
  context: string,
  options?: CommandSequenceOptions,
): void {
  if (options?.exact === true) {
    assert.deepStrictEqual(
      commands,
      expected,
      [
        `${context} must match expected sequence exactly`,
        '',
        'expected:',
        formatSequenceDiff(expected),
        'actual:',
        formatSequenceDiff(commands),
      ].join('\n'),
    );

    return;
  }

  let cursor = -1;

  for (const command of expected) {
    const nextIndex = commands.findIndex(
      (entry, index) => index > cursor && entry === command,
    );

    assert.notStrictEqual(
      nextIndex,
      -1,
      `${context} must include "${command}" after index ${cursor}`,
    );

    cursor = nextIndex;
  }
}

function formatSequenceDiff(sequence: string[]): string {
  return sequence.map((entry) => `  - ${entry}`).join('\n');
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
  const expectedTokens = expected.split(/\s+/u).filter(Boolean);
  const requiredTokens = expectedTokens.filter((token) =>
    token.startsWith('--test-reporter'),
  );

  const pnpmTestCommands = commands
    .map((command) => ({
      command,
      tokens: command.split(/\s+/u).filter(Boolean),
    }))
    .filter(({ tokens }) => tokens[0] === 'pnpm' && tokens.includes('test'));

  const matchingCommand = pnpmTestCommands.find(({ tokens }) =>
    requiredTokens.every((token) => tokens.includes(token)),
  );

  if (matchingCommand) {
    return;
  }

  const missingTokens = requiredTokens.filter((token) =>
    pnpmTestCommands.every(({ tokens }) => !tokens.includes(token)),
  );

  const details = [message];

  if (missingTokens.length > 0) {
    details.push('', 'missing junit tokens:', formatSequenceDiff(missingTokens));
  }

  details.push('', formatCommandDiff(commands, expected));

  assert.fail(details.join('\n'));
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
  const matches = assertStepsWithName(steps, expectedName, message);

  return matches[0];
}

function assertStepsWithName(
  steps: StepConfig[],
  expectedName: string,
  message: string,
): StepConfig[] {
  const matches = steps.filter(
    (step) => typeof step.name === 'string' && step.name.trim() === expectedName,
  );

  if (matches.length === 0) {
    assert.fail(message);
  }

  return matches;
}

function assertStepWithNameAndId(
  steps: StepConfig[],
  expectedName: string,
  expectedId: string,
  message: string,
): StepConfig {
  const matches = assertStepsWithName(steps, expectedName, message);
  const match = matches.find(
    (step) => typeof step.id === 'string' && step.id.trim() === expectedId,
  );

  if (!match) {
    assert.fail(`${message}; expected id "${expectedId}"`);
  }

  return match;
}

function assertDetectAutosaveChangesStep(
  steps: StepConfig[],
  message: string,
): PathsFilterStep {
  const step = assertStepWithNameAndId(
    steps,
    'Detect autosave changes',
    'autosave_paths',
    message,
  );

  assertStepUsesEquals(
    step,
    'dorny/paths-filter@v3',
    `${message}; step must use dorny/paths-filter@v3`,
  );

  assertPathsFilterStepShape(
    step,
    `${message}; step.with must be an object when provided`,
  );

  return step;
}

function assertPathsFilterStepShape(
  step: StepConfig,
  message: string,
): asserts step is PathsFilterStep {
  const config = step.with;

  if (config === undefined) {
    return;
  }

  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    assert.fail(message);
  }
}

type RunSuiteStepId = (typeof expectedRunSuiteStepIds)[number];

type RunSuiteStepCollection = Record<RunSuiteStepId, StepConfig>;

type RunSuiteSteps = {
  autosave: StepConfig;
  default: StepConfig;
};

function assertRunSuiteSteps(steps: StepConfig[], message: string): RunSuiteSteps {
  const collection = assertRunSuiteStepCollection(steps, message);

  return {
    autosave: collection.run_suite_autosave,
    default: collection.run_suite_default,
  };
}

function assertRunSuiteStepCollection(
  steps: StepConfig[],
  message: string,
): RunSuiteStepCollection {
  const matches = steps.filter(
    (step) => typeof step.name === 'string' && step.name.trim() === 'Run ${{ matrix.suite }} suite',
  );

  if (matches.length !== expectedRunSuiteStepIds.length) {
    assert.fail(`${message}; expected exactly ${expectedRunSuiteStepIds.length} steps but found ${matches.length}`);
  }

  const collection: Partial<RunSuiteStepCollection> = {};

  for (const expectedId of expectedRunSuiteStepIds) {
    const match = matches.find((step) => typeof step.id === 'string' && step.id.trim() === expectedId);

    if (!match) {
      assert.fail(`${message}; missing step with id "${expectedId}"`);
    }

    collection[expectedId] = match;
  }

  return collection as RunSuiteStepCollection;
}

function assertStepIdEquals(
  step: StepConfig | StepConfig[],
  expected: string | string[],
  message: string,
): void {
  if (Array.isArray(step)) {
    if (!Array.isArray(expected)) {
      assert.fail(`${message}; expected ids must be provided as an array`);
    }

    assert.strictEqual(
      step.length,
      expected.length,
      `${message}; number of steps must match number of expected ids`,
    );

    step.forEach((entry, index) => {
      assertStepIdEquals(entry, expected[index], message);
    });

    return;
  }

  if (typeof step.id !== 'string') {
    assert.fail(`${message}; step.id must be configured as a string`);
  }

  if (Array.isArray(expected)) {
    assert.fail(`${message}; expected ids must be provided as a string`);
  }

  assert.strictEqual(step.id.trim(), expected, message);
}

function assertStepUsesEquals(step: StepConfig, expected: string, message: string): void {
  if (typeof step.uses !== 'string') {
    assert.fail(`${message}; step.uses must be configured as a string`);
  }

  assert.strictEqual(step.uses.trim(), expected, message);
}

type SuiteFailureConditionExpectation = {
  prerequisites?: string[];
  failureChecks: string[];
};

type SuiteFailureCondition = {
  prerequisites: string[];
  failureChecks: string[];
};

function assertSuiteFailureCondition(
  step: StepConfig,
  expected: SuiteFailureConditionExpectation,
  message: string,
): void {
  if (typeof step.if !== 'string') {
    assert.fail(`${message}; step.if must be configured as a string`);
  }

  const actual = parseSuiteFailureCondition(step.if);
  const expectedPrerequisites = expected.prerequisites ?? [];

  assertStringSetEquals(
    actual.prerequisites,
    expectedPrerequisites,
    `${message}; prerequisites must match expected set`,
  );

  assertStringSetEquals(
    actual.failureChecks,
    expected.failureChecks,
    `${message}; failure checks must match expected set`,
  );
}

function parseSuiteFailureCondition(source: string): SuiteFailureCondition {
  const normalized = normalizeIfConditionSource(source);
  const parts = splitByOperator(normalized, '&&');

  if (parts.length === 0) {
    assert.fail('if condition must not be empty');
  }

  const prerequisites = parts.slice(0, -1);
  const failureExpression = parts[parts.length - 1];
  const normalizedFailure = unwrapParentheses(failureExpression);
  const failureChecks = splitByOperator(normalizedFailure, '||');

  if (failureChecks.length === 0) {
    assert.fail('if condition must check for run suite failures');
  }

  return {
    prerequisites,
    failureChecks,
  };
}

function normalizeIfConditionSource(source: string): string {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .replace(/\s*\(\s*/gu, '(')
    .replace(/\s*\)\s*/gu, ')')
    .trim();
}

function splitByOperator(expression: string, operator: '&&' | '||'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let index = 0;
  let start = 0;

  while (index < expression.length) {
    const char = expression[index];

    if (char === '(') {
      depth += 1;
      index += 1;
      continue;
    }

    if (char === ')') {
      depth -= 1;
      if (depth < 0) {
        assert.fail('if condition contains unmatched closing parenthesis');
      }

      index += 1;
      continue;
    }

    if (depth === 0 && expression.startsWith(operator, index)) {
      parts.push(expression.slice(start, index).trim());
      index += operator.length;
      start = index;
      continue;
    }

    index += 1;
  }

  if (depth !== 0) {
    assert.fail('if condition contains unmatched opening parenthesis');
  }

  parts.push(expression.slice(start).trim());

  return parts.filter((part) => part.length > 0);
}

function unwrapParentheses(expression: string): string {
  let result = expression.trim();

  while (result.startsWith('(') && result.endsWith(')')) {
    const inner = result.slice(1, -1);

    if (!areParenthesesBalanced(inner)) {
      break;
    }

    result = inner.trim();
  }

  return result;
}

function areParenthesesBalanced(expression: string): boolean {
  let depth = 0;

  for (const char of expression) {
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;

      if (depth < 0) {
        return false;
      }
    }
  }

  return depth === 0;
}

function assertStringSetEquals(actual: string[], expected: string[], message: string): void {
  const actualNormalized = actual.map((value) => value.trim()).filter((value) => value.length > 0);
  const expectedNormalized = expected.map((value) => value.trim()).filter((value) => value.length > 0);
  const actualSorted = Array.from(new Set(actualNormalized)).sort();
  const expectedSorted = Array.from(new Set(expectedNormalized)).sort();

  assert.deepStrictEqual(
    actualSorted,
    expectedSorted,
    [
      message,
      '',
      'expected:',
      ...expectedSorted.map((entry) => `  - ${entry}`),
      'actual:',
      ...actualSorted.map((entry) => `  - ${entry}`),
    ].join('\n'),
  );
}

function getPathsFilterGlobs(
  step: PathsFilterStep,
  filterName: string,
  message: string,
): string[] {
  const config = step.with;
  if (!config || typeof config !== 'object') {
    assert.fail(`${message}; step.with must be configured as an object`);
  }

  const filters = (config as { filters?: unknown }).filters;

  if (typeof filters !== 'string') {
    assert.fail(`${message}; step.with.filters must be configured as a string`);
  }

  const parsed = load(filters);

  if (!parsed || typeof parsed !== 'object') {
    assert.fail(`${message}; filters YAML must deserialize into an object`);
  }

  const filterEntries = (parsed as Record<string, unknown>)[filterName];

  if (!Array.isArray(filterEntries)) {
    assert.fail(`${message}; filters must define array for "${filterName}"`);
  }

  const globs = filterEntries.map((entry, index) => {
    if (typeof entry !== 'string') {
      assert.fail(
        `${message}; filters.${filterName}[${index}] must be configured as a string`,
      );
    }

    return entry.trim();
  });

  return globs;
}

function assertPathsFilterGlobs(
  step: PathsFilterStep,
  filterName: string,
  expectedGlobs: string[],
  message: string,
): void {
  const globs = getPathsFilterGlobs(step, filterName, message);

  assertStringSetEquals(globs, expectedGlobs, message);
}

function assertStepIfEquals(step: StepConfig, expected: string, message: string): void {
  if (typeof step.if !== 'string') {
    assert.fail(`${message}; step.if must be configured as a string`);
  }

  const actualNormalized = normalizeMultiline(step.if);
  const expectedNormalized = normalizeMultiline(expected);

  assert.strictEqual(actualNormalized, expectedNormalized, message);
}

function assertStepContinueOnError(step: StepConfig, message: string): void {
  const value = step['continue-on-error'];

  // boolean の場合
  if (typeof value === 'boolean') {
    assert.strictEqual(value, true, message);
    return;
  }

  // string の場合（柔軟に許容）
  if (typeof value === 'string') {
    assert.strictEqual(value.trim(), 'true', message);
    return;
  }

  // それ以外はエラー
  assert.fail(`${message}; continue-on-error must be configured as boolean true or string 'true'`);
}

function assertStepRunIncludesLine(step: StepConfig, expectedLine: string, message: string): void {
  if (typeof step.run !== 'string') {
    assert.fail(`${message}; step.run must be configured as a string`);
  }

  const lines = step.run
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const index = lines.findIndex((line) => line.includes(expectedLine));

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

function normalizeMultiline(value: string): string {
  return value
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

function assertJobNeedsIncludeAll(
  value: JobNeedsConfig,
  expected: string[],
  message: string,
): void {
  const needs = normalizeJobNeeds(value, message);

  for (const dependency of expected) {
    const hasMatch = needs.includes(dependency);
    assert.ok(hasMatch, `${message}; needs must include "${dependency}"`);
  }
}

function normalizeJobNeeds(value: JobNeedsConfig, message: string): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value;
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

function assertUploadArtifactIfNoFilesFoundEquals(
  step: UploadArtifactStep,
  expected: string,
  message: string,
): void {
  const config = step.with;
  if (!config || typeof config !== 'object') {
    assert.fail(`${message}; step.with must be configured`);
  }

  const value = (config as { 'if-no-files-found'?: unknown })['if-no-files-found'];
  if (typeof value !== 'string') {
    assert.fail(`${message}; if-no-files-found must be configured as a string`);
  }

  assert.strictEqual(value.trim(), expected, message);
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

function extractMatrixSuites(entries: QualityMatrixEntry[]): string[] {
  return entries.flatMap((entry) => {
    if (typeof entry.suite !== 'string') {
      return [];
    }

    return [entry.suite.trim()];
  });
}

async function readWorkflowYaml(): Promise<WorkflowYaml> {
  const workflow = await loadWorkflow();
  if (!workflow || typeof workflow !== 'object') {
    assert.fail('workflow must parse to an object');
  }
  return workflow as WorkflowYaml;
}
