/// <reference types="node" />
process.env.TS_NODE_COMPILER_OPTIONS ??= JSON.stringify({ moduleResolution: 'bundler' });
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

type WorkflowYaml = { jobs?: { sbom?: WorkflowJob; golden?: WorkflowJob } };
type WorkflowJob = { steps?: StepConfig[]; needs?: JobNeeds };
type StepConfig = {
  id?: unknown;
  name?: unknown;
  run?: unknown;
  uses?: unknown;
  with?: unknown;
  if?: unknown;
  'continue-on-error'?: unknown;
};
type UploadStep = StepConfig & {
  uses: string;
  with?: { name?: unknown; path?: unknown; 'if-no-files-found'?: unknown };
};
type JobNeeds = string | string[] | undefined;
type JsYamlModule = { load: (input: string) => unknown };
const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowPath = resolve(repoRoot, '.github', 'workflows', 'ci.yml');

describe('ci workflow golden job', () => {
  test('uploads SBOM and golden comparison artifacts required by CI spec', async () => {
    try {
      const workflow = await loadWorkflow();
      const sbomSteps = expectJobSteps(workflow.jobs?.sbom, 'sbom job must exist');
      const sbomUpload = expectUploadStep(sbomSteps, 'sbom', 'sbom job must upload sbom.json');
      const sbomPath = sbomUpload.with?.path;
      if (typeof sbomPath !== 'string') throw new TypeError('sbom artifact upload must configure string path');
      assert.strictEqual(sbomPath.trim(), 'sbom.json', 'sbom artifact must target sbom.json');
      const goldenJob = workflow.jobs?.golden;
      if (!goldenJob) throw new Error('golden job must exist');
      const goldenNeeds = normalizeJobNeeds(goldenJob.needs);
      assert.ok(goldenNeeds.includes('build'), 'golden job must depend on build job');
      const goldenSteps = expectJobSteps(goldenJob, 'golden job must exist');
      const goldenRun = goldenSteps.find(
        (step) => typeof step.run === 'string' && step.run.includes('pnpm -s golden:ci'),
      );
      if (!goldenRun || typeof goldenRun.run !== 'string') {
        throw new Error('golden job must execute pnpm golden comparison');
      }
      assert.ok(goldenRun.run.includes('pnpm -s golden:ci'), 'golden job must run pnpm -s golden:ci');

      const goldenExecution = goldenSteps.find(
        (step) => typeof step.name === 'string' && step.name.trim() === 'Run golden comparison',
      );
      if (!goldenExecution) {
        throw new Error('golden job must name golden comparison step');
      }
      const goldenId = goldenExecution.id;
      if (typeof goldenId !== 'string') {
        throw new TypeError('golden comparison step must configure string id');
      }
      assert.strictEqual(
        goldenId.trim(),
        'golden',
        "golden comparison step id must equal 'golden'",
      );
      const continueOnError = goldenExecution['continue-on-error'];
      if (typeof continueOnError === 'string') {
        assert.strictEqual(
          continueOnError.trim(),
          'true',
          "golden comparison step must set continue-on-error to string 'true'",
        );
      } else if (typeof continueOnError === 'boolean') {
        assert.strictEqual(
          continueOnError,
          true,
          'golden comparison step must set continue-on-error to true',
        );
      } else {
        throw new TypeError('golden comparison step must configure continue-on-error');
      }

      const goldenUpload = expectUploadStep(
        goldenSteps,
        'golden-artifacts',
        'golden job must upload golden artifacts',
        { expectedIf: 'always()', expectedStepName: 'Upload golden artifacts' },
      );
      const uploadPath = goldenUpload.with?.path;
      if (typeof uploadPath !== 'string') throw new TypeError('golden artifact upload must configure path string');
      const entries = uploadPath.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
      for (const expected of ['golden.log', 'golden-diff.txt', 'runs']) {
        assert.ok(entries.includes(expected), `golden artifact upload must include ${expected}`);
      }

      const ifNoFilesFound = goldenUpload.with?.['if-no-files-found'];
      if (typeof ifNoFilesFound !== 'string') {
        throw new TypeError('golden artifact upload must configure if-no-files-found string');
      }
      assert.strictEqual(
        ifNoFilesFound.trim(),
        'error',
        "golden artifact upload must set if-no-files-found to string 'error'",
      );

      const assertStep = goldenSteps.find(
        (step) => typeof step.name === 'string' && step.name.trim() === 'Assert golden comparison passed',
      );
      if (!assertStep) {
        throw new Error('golden job must assert golden comparison outcome');
      }
      const ifCondition = assertStep.if;
      if (typeof ifCondition !== 'string') {
        throw new TypeError('assertion step must configure string if condition');
      }
      assert.strictEqual(
        ifCondition.trim(),
        "steps.golden.outcome == 'failure'",
        'assertion step must guard on golden step failure',
      );
      const assertRun = assertStep.run;
      if (typeof assertRun !== 'string') {
        throw new TypeError('assertion step must configure string run command');
      }
      assert.strictEqual(assertRun.trim(), 'exit 1', 'assertion step must exit 1 on failure');
    } catch (error) {
      console.error('CI golden workflow verification failed:', error);
      throw error;
    }
  });
});

function findUploadStep(steps: StepConfig[], name: string): UploadStep | undefined {
  return steps.find((step): step is UploadStep => {
    if (typeof step.uses !== 'string') return false;
    if (step.uses.trim() !== 'actions/upload-artifact@v4') return false;
    const config = step.with;
    if (!config || typeof config !== 'object') return false;
    return 'name' in config && (config as { name: unknown }).name === name;
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

function normalizeJobNeeds(needs: JobNeeds): string[] {
  if (typeof needs === 'undefined') return [];
  if (typeof needs === 'string') {
    const normalized = needs.trim();
    return normalized.length > 0 ? [normalized] : [];
  }
  if (Array.isArray(needs)) {
    return needs.map((entry) => {
      if (typeof entry !== 'string') {
        throw new TypeError('job needs entries must be strings');
      }
      const normalized = entry.trim();
      if (normalized.length === 0) {
        throw new TypeError('job needs entries must be non-empty strings');
      }
      return normalized;
    });
  }
  throw new TypeError('job needs must be a string or string array');
}

function expectJobSteps(job: WorkflowJob | undefined, message: string): StepConfig[] {
  if (!job) throw new Error(message);
  if (!Array.isArray(job.steps)) throw new Error('job.steps must be an array');
  return job.steps;
}

type UploadStepExpectations = {
  expectedIf?: string;
  expectedStepName?: string;
};

function expectUploadStep(
  steps: StepConfig[],
  name: string,
  message: string,
  expectations?: UploadStepExpectations,
): UploadStep {
  const match = findUploadStep(steps, name);
  if (!match) {
    throw new Error(message);
  }
  if (expectations?.expectedStepName) {
    if (typeof match.name !== 'string') {
      throw new TypeError('upload step must define a string name');
    }
    const actualName = match.name.trim();
    if (actualName !== expectations.expectedStepName) {
      throw new Error(`upload step must be named ${expectations.expectedStepName}`);
    }
  }
  if (typeof expectations?.expectedIf !== 'undefined') {
    if (typeof match.if !== 'string') {
      throw new TypeError('upload step must configure string if condition');
    }
    const actualIf = match.if.trim();
    if (actualIf !== expectations.expectedIf) {
      throw new Error(`upload step must configure if: ${expectations.expectedIf}`);
    }
  }
  return match;
}
