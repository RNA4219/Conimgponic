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
type UploadStep = StepConfig & { uses: string; with?: { name?: unknown; path?: unknown } };
type JsYamlModule = { load: (input: string) => unknown };
const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowPath = resolve(repoRoot, '.github', 'workflows', 'ci.yml');

describe('ci workflow sbom job', () => {
  test('generates sbom.json via Syft and always uploads artifact', async () => {
    try {
      const workflow = await loadWorkflow();
      const sbomSteps = expectJobSteps(workflow.jobs?.sbom, 'sbom job must exist');
      const syftStep = expectRunStep(
        sbomSteps,
        (step) => typeof step.run === 'string' && step.run.includes('syft') && step.run.includes('sbom.json'),
        'sbom job must run syft to produce sbom.json',
      );
      assert.ok(
        syftStep.run.includes('cyclonedx-json=sbom.json'),
        'syft command must output cyclonedx-json=sbom.json',
      );
      const uploadStep = expectUploadStep(sbomSteps, 'sbom', 'sbom job must upload sbom.json artifact');
      const uploadIf = uploadStep.if;
      if (uploadIf !== undefined && typeof uploadIf !== 'string') {
        throw new TypeError('upload step if condition must be a string when present');
      }
      assert.strictEqual(uploadIf?.trim(), 'always()', 'sbom artifact upload must run unconditionally via always()');
      const uploadPath = uploadStep.with?.path;
      if (typeof uploadPath !== 'string') throw new TypeError('sbom artifact path must be a string');
      assert.strictEqual(uploadPath.trim(), 'sbom.json', 'sbom artifact must point to sbom.json');
    } catch (error) {
      console.error('CI SBOM workflow verification failed:', error);
      throw error;
    }
  });
});

function expectRunStep(
  steps: StepConfig[],
  predicate: (step: StepConfig & { run: string }) => boolean,
  message: string,
): StepConfig & { run: string } {
  const match = steps.find((step): step is StepConfig & { run: string } => {
    if (typeof step.run !== 'string') return false;
    const withRun = step as StepConfig & { run: string };
    return predicate(withRun);
  });
  if (!match) {
    throw new Error(message);
  }
  return match;
}

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
