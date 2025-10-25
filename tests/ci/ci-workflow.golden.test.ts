/// <reference types="node" />
process.env.TS_NODE_COMPILER_OPTIONS ??= JSON.stringify({ moduleResolution: 'bundler' });
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

type WorkflowYaml = { jobs?: { sbom?: WorkflowJob; golden?: WorkflowJob } };
type WorkflowJob = { steps?: StepConfig[] };
type StepConfig = { name?: unknown; run?: unknown; uses?: unknown; with?: unknown };
type UploadStep = StepConfig & { uses: string; with?: { name?: unknown; path?: unknown } };
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
      const goldenSteps = expectJobSteps(workflow.jobs?.golden, 'golden job must exist');
      const goldenRun = goldenSteps.find(
        (step) => typeof step.run === 'string' && step.run.includes('pnpm -s golden:ci'),
      );
      if (!goldenRun || typeof goldenRun.run !== 'string') {
        throw new Error('golden job must execute pnpm golden comparison');
      }
      assert.ok(goldenRun.run.includes('pnpm -s golden:ci'), 'golden job must run pnpm -s golden:ci');

      const goldenUpload = expectUploadStep(goldenSteps, 'golden-artifacts', 'golden job must upload golden artifacts');
      const uploadPath = goldenUpload.with?.path;
      if (typeof uploadPath !== 'string') throw new TypeError('golden artifact upload must configure path string');
      const entries = uploadPath.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
      for (const expected of ['golden.log', 'golden-diff.txt', 'runs']) {
        assert.ok(entries.includes(expected), `golden artifact upload must include ${expected}`);
      }
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

function expectJobSteps(job: WorkflowJob | undefined, message: string): StepConfig[] {
  if (!job) throw new Error(message);
  if (!Array.isArray(job.steps)) throw new Error('job.steps must be an array');
  return job.steps;
}

function expectUploadStep(
  steps: StepConfig[],
  name: string,
  message: string,
): UploadStep {
  const match = findUploadStep(steps, name);
  if (!match) {
    throw new Error(message);
  }
  return match;
}
