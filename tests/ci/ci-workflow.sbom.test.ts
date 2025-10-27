/// <reference types="node" />
process.env.TS_NODE_COMPILER_OPTIONS ??= JSON.stringify({ moduleResolution: 'bundler' });
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

type WorkflowYaml = { jobs?: { sbom?: WorkflowJob } };
type WorkflowJob = { steps?: StepConfig[] };
type StepConfig = { name?: unknown; run?: unknown; uses?: unknown; with?: unknown; if?: unknown };
type ActionStep<TConfig extends Record<string, unknown>> = StepConfig & { uses: string; with: TConfig };
type AnchoreSbomConfig = { format: string; 'output-file': string };
type UploadArtifactConfig = {
  name: string;
  path: string;
  'if-no-files-found': string;
};
type UploadStep = StepConfig & { uses: string; with: UploadArtifactConfig };
type JsYamlModule = { load: (input: string) => unknown };
const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowPath = resolve(repoRoot, '.github', 'workflows', 'ci.yml');

describe('ci workflow sbom job', () => {
  test('installs syft exactly once and prepares PATH', async () => {
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
      installScript.includes('mkdir -p "$HOME/.local/bin"'),
      'Install Syft step must create the local bin directory',
    );
    assert(
      installScript.includes('echo "$HOME/.local/bin" >> "$GITHUB_PATH"'),
      'Install Syft step must append the local bin directory to GITHUB_PATH',
    );
  });

  test('generates sbom.json via Anchore SBOM action and always uploads artifact', async () => {
    try {
      const workflow = await loadWorkflow();
      const sbomSteps = expectJobSteps(workflow.jobs?.sbom, 'sbom job must exist');
      const sbomAction = expectActionStep<AnchoreSbomConfig>(
        sbomSteps,
        'anchore/sbom-action@v0.17.6',
        'sbom job must use Anchore SBOM action to produce sbom.json',
      );
      assert.strictEqual(
        sbomAction.with.format,
        'spdx-json',
        'Anchore SBOM action must emit spdx-json format',
      );
      assert.strictEqual(
        sbomAction.with['output-file'],
        'sbom.json',
        'Anchore SBOM action must output sbom.json',
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

  test('uploads sbom log artifact only on failure', async () => {
    const workflow = await loadWorkflow();
    const sbomSteps = expectJobSteps(workflow.jobs?.sbom, 'sbom job must exist');
    const uploadLogStep = expectUploadStep(
      sbomSteps,
      'sbom-log',
      'sbom job must upload sbom log artifact on failure',
      {
        stepName: 'Upload SBOM log on failure',
        ifCondition: 'failure()',
      },
    );

    const uploadPath = uploadLogStep.with.path;
    assert.strictEqual(uploadPath.trim(), 'sbom.log', 'sbom log artifact must point to sbom.log');

    const ifNoFilesFound = uploadLogStep.with['if-no-files-found'];
    assert.strictEqual(
      ifNoFilesFound,
      'ignore',
      'sbom log artifact upload must ignore missing files to avoid masking primary failures',
    );
  });
});

function expectActionStep<TConfig extends Record<string, unknown>>(
  steps: StepConfig[],
  uses: string,
  message: string,
): ActionStep<TConfig> {
  const match = steps.find((step): step is ActionStep<Record<string, unknown>> => {
    if (typeof step.uses !== 'string') return false;
    return step.uses.trim() === uses;
  });
  if (!match) {
    throw new Error(message);
  }
  if (!match.with || typeof match.with !== 'object') {
    throw new Error('action step must configure the with block');
  }
  return match as ActionStep<TConfig>;
}

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

async function importJsYaml(): Promise<JsYamlModule> {
  const pnpmDir = resolve(repoRoot, 'node_modules', '.pnpm');
  const entries = await readdir(pnpmDir, { withFileTypes: true });
  const match = entries.find((entry) => entry.isDirectory() && entry.name.startsWith('js-yaml@'));
  if (!match) {
    assert.fail('js-yaml must be present in pnpm store');
  }
  const moduleDir = resolve(pnpmDir, match.name, 'node_modules', 'js-yaml');
  return require(moduleDir) as JsYamlModule;
}

async function loadWorkflow(): Promise<WorkflowYaml> {
  const { load } = await importJsYaml();
  const source = await readFile(workflowPath, 'utf8');
  const parsed = load(source) as WorkflowYaml | null;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('workflow must parse to an object');
  }
  return parsed as WorkflowYaml;
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
