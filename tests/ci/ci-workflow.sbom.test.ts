/// <reference types="node" />
process.env.TS_NODE_COMPILER_OPTIONS ??= JSON.stringify({ moduleResolution: 'bundler' });
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadWorkflow } from './utils/workflow-loader.js';

type WorkflowYaml = { jobs?: { sbom?: WorkflowJob } };
type WorkflowJob = { steps?: StepConfig[] };
type StepConfig = {
  name?: unknown;
  run?: unknown;
  uses?: unknown;
  with?: unknown;
  if?: unknown;
  env?: unknown;
  id?: unknown;
  'continue-on-error'?: unknown;
};
type UploadArtifactConfig = {
  name: string;
  path: string;
  'if-no-files-found': string;
};
type UploadStep = StepConfig & { uses: string; with: UploadArtifactConfig };
type RunStep = StepConfig & { name: string; run: string };
const expectedSyftPackageSpecifier = '@anchore/syft@1.16.0';
const expectedSyftDlxPrefix = `pnpm dlx --package=${expectedSyftPackageSpecifier}`;

describe('ci workflow sbom job', () => {
  test('installs syft via pnpm dlx exactly once', async () => {
    const workflow = await loadWorkflow();
    const sbomSteps = expectJobSteps(workflow.jobs?.sbom, 'sbom job must exist');

    const installSteps = sbomSteps.filter((step): step is StepConfig & { name: string; run: string } => {
      if (typeof step.name !== 'string') return false;
      if (step.name.trim() !== 'Install Syft') return false;
      return typeof step.run === 'string';
    });

    assert.strictEqual(
      installSteps.length,
      1,
      'sbom job must define exactly one Install Syft step',
    );

    const installScript = installSteps[0].run;
    assert(
      installScript.includes(`${expectedSyftDlxPrefix} --version`),
      'Install Syft step must execute pnpm dlx for @anchore/syft with a pinned version',
    );
    assert(
      !installScript.includes('curl '),
      'Install Syft step must not rely on curl-based installers',
    );
  });

  test('produces sbom.json via syft CLI and always uploads artifact', async () => {
    try {
      const workflow = await loadWorkflow();
      const sbomSteps = expectJobSteps(workflow.jobs?.sbom, 'sbom job must exist');
      const sbomRunStep = expectRunStep(sbomSteps, 'Generate SBOM', 'sbom job must run syft CLI to generate sbom.json');
      const envConfig = sbomRunStep.env;
      assert.ok(envConfig && typeof envConfig === 'object', 'Generate SBOM step must define env block');
      const syftUpdateSetting = (envConfig as Record<string, unknown>).SYFT_CHECK_FOR_APP_UPDATE;
      assert.strictEqual(
        syftUpdateSetting,
        'false',
        'Generate SBOM step must disable update checks via SYFT_CHECK_FOR_APP_UPDATE="false"',
      );
      const syftLogFile = (envConfig as Record<string, unknown>).SYFT_LOG_FILE;
      assert.strictEqual(
        syftLogFile,
        'sbom.log',
        'Anchore SBOM action must log to sbom.log via SYFT_LOG_FILE="sbom.log"',
      );
      const uploadStep = expectUploadStep(sbomSteps, 'sbom', 'sbom job must upload sbom.json artifact', {
        ifCondition: 'always()',
        stepName: 'Upload SBOM artifact',
      });
      const uploadPath = uploadStep.with.path;
      assert.strictEqual(uploadPath.trim(), 'sbom.json', 'sbom artifact must point to sbom.json');
      const ifNoFilesFound = uploadStep.with['if-no-files-found'];
      assert.strictEqual(
        ifNoFilesFound,
        'error',
        "sbom artifact upload must fail if sbom.json isn't produced",
      );
    } catch (error) {
      console.error('CI SBOM workflow verification failed:', error);
      throw error;
    }
  });

  test('configures sbom log upload conditional on syft failure output', async () => {
    const workflow = await loadWorkflow();
    const sbomSteps = expectJobSteps(workflow.jobs?.sbom, 'sbom job must exist');

    expectUploadStep(sbomSteps, 'sbom-log', 'sbom log upload step must exist', {
      stepName: 'Upload SBOM log on failure',
      ifCondition: "steps.generate_sbom.outputs.exit_code != '0'",
    });
  });

  test('uploads sbom log artifact only on failure', async () => {
    const workflow = await loadWorkflow();
    const sbomSteps = expectJobSteps(workflow.jobs?.sbom, 'sbom job must exist');
    const uploadLogStep = expectUploadStep(
      sbomSteps,
      'sbom-log',
      'sbom job must upload sbom log artifact on failure',
      {
        stepName: 'Upload SBOM log on failure',
      },
    );

    const uploadPath = uploadLogStep.with.path;
    assert.strictEqual(uploadPath.trim(), 'sbom.log', 'sbom log artifact must point to sbom.log');

    const ifNoFilesFound = uploadLogStep.with['if-no-files-found'];
    assert.strictEqual(
      typeof ifNoFilesFound,
      'string',
      'sbom log artifact upload must configure if-no-files-found option explicitly',
    );
    assert.strictEqual(
      ifNoFilesFound,
      'error',
      'sbom log artifact upload must set if-no-files-found="error" to fail fast when sbom.log is missing',
    );
  });

  test('runs syft CLI with tee logging and fails explicitly on non-zero exit code', async () => {
    const workflow = await loadWorkflow();
    const sbomSteps = expectJobSteps(workflow.jobs?.sbom, 'sbom job must exist');

    const generateStep = expectRunStep(
      sbomSteps,
      'Generate SBOM',
      'sbom job must define Generate SBOM run step',
    );
    assert.strictEqual(generateStep.id, 'generate_sbom', 'Generate SBOM step must expose id for outputs');
    assert.strictEqual(
      generateStep['continue-on-error'],
      true,
      'Generate SBOM step must continue on error to allow log uploads',
    );

    const runScript = generateStep.run;
    assert.ok(
      runScript.includes(`${expectedSyftDlxPrefix} packages `),
      'Generate SBOM step must invoke syft CLI via pnpm dlx with a pinned version',
    );
    assert.ok(
      runScript.includes('status=$?'),
      'Generate SBOM step must capture syft exit status for later evaluation',
    );
    assert.ok(
      runScript.includes('|& tee sbom.log'),
      'Generate SBOM step must pipe stdout/stderr through tee to sbom.log',
    );
    assert.ok(
      runScript.includes('echo "exit_code=$status" >> "$GITHUB_OUTPUT"'),
      'Generate SBOM step must record syft exit code into GITHUB_OUTPUT',
    );
    assert.ok(
      !runScript.includes('exit "$status"'),
      'Generate SBOM step must not exit with syft status; the dedicated failure step must handle termination',
    );

    const failStep = sbomSteps.find((step): step is StepConfig & { name: string; run: string } => {
      if (typeof step.name !== 'string') return false;
      if (step.name.trim() !== 'Fail when syft exits non-zero') return false;
      return typeof step.run === 'string';
    });

    assert.ok(failStep, 'sbom job must define explicit failure step for syft exit code');
    assert.ok(
      typeof failStep.if === 'string',
      'failure step must define conditional expression on syft exit code',
    );
    assert.strictEqual(
      (failStep.if as string).trim(),
      "steps.generate_sbom.outputs.exit_code != '0'",
      'failure step must check syft exit code output',
    );
    assert.ok(
      failStep.run.includes('exit "${{ steps.generate_sbom.outputs.exit_code }}"'),
      'failure step must exit with syft exit code to fail job',
    );
  });
});

function findUploadStep(steps: StepConfig[], name: string): UploadStep | undefined {
  return steps.find((step): step is UploadStep => {
    if (typeof step.uses !== 'string') return false;
    if (step.uses.trim() !== 'actions/upload-artifact@v4') return false;
    const config = step.with;
    if (!config || typeof config !== 'object') return false;
    const typedConfig = config as Partial<UploadArtifactConfig> & { [key: string]: unknown };
    if (typeof typedConfig.name !== 'string') return false;
    if (typedConfig.name !== name) return false;
    if (typeof typedConfig.path !== 'string') return false;
    if (typeof typedConfig['if-no-files-found'] !== 'string') return false;
    return true;
  });
}

function expectRunStep(steps: StepConfig[], name: string, message: string): RunStep {
  const match = steps.find((step): step is RunStep => {
    if (typeof step.name !== 'string') return false;
    if (step.name.trim() !== name) return false;
    return typeof step.run === 'string';
  });
  if (!match) {
    throw new Error(message);
  }
  return match;
}

function expectJobSteps(job: WorkflowJob | undefined, message: string): StepConfig[] {
  if (!job) throw new Error(message);
  if (!Array.isArray(job.steps)) throw new Error('job.steps must be an array');
  return job.steps;
}

type UploadStepOptions = {
  ifCondition?: string;
  stepName?: string;
};

function expectUploadStep(
  steps: StepConfig[],
  name: string,
  message: string,
  options?: UploadStepOptions,
): UploadStep {
  const match = findUploadStep(steps, name);
  if (!match) {
    throw new Error(message);
  }
  if (options?.stepName !== undefined) {
    if (typeof match.name !== 'string') {
      throw new Error('upload step name must be a string when asserting the step name');
    }
    if (match.name.trim() !== options.stepName) {
      throw new Error(`upload step name must be ${options.stepName}`);
    }
  }
  if (options?.ifCondition !== undefined) {
    if (match.if === undefined) {
      throw new Error('upload step must define an if condition when asserting the condition');
    }
    if (typeof match.if !== 'string') {
      throw new TypeError('upload step if condition must be a string when present');
    }
    if (match.if.trim() !== options.ifCondition) {
      throw new Error(`upload step if condition must be ${options.ifCondition}`);
    }
  }
  return match;
}
