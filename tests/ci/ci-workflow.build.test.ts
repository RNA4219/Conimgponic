/// <reference types="node" />
process.env.TS_NODE_COMPILER_OPTIONS ??= JSON.stringify({ moduleResolution: 'bundler' });
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';
type WorkflowYaml = { jobs?: { build?: WorkflowJob } };
type WorkflowJob = { steps?: StepConfig[] };
type StepConfig = { name?: unknown; run?: unknown; uses?: unknown; with?: unknown };
type UploadStep = StepConfig & {
  uses: string;
  with?: { name?: unknown; path?: unknown };
  if?: unknown;
};
type JsYamlModule = { load: (input: string) => unknown };
const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowPath = resolve(repoRoot, '.github', 'workflows', 'ci.yml');
describe('ci workflow build job', () => {
  test('build job runs pnpm build and uploads artifacts', async () => {
    try {
      const workflow = await loadWorkflow();
      const buildSteps = expectJobSteps(workflow.jobs?.build, 'build job must exist');
      const buildRun = buildSteps.find(
        (step) => typeof step.run === 'string' && step.run.includes('pnpm --reporter ndjson -s build'),
      );
      if (!buildRun || typeof buildRun.run !== 'string') throw new Error('build job must run pnpm --reporter ndjson -s build');
      const distUpload = expectUploadStep(buildSteps, 'dist', 'build job must upload dist artifact');
      const distCondition = distUpload.if;
      if (typeof distCondition !== 'string') throw new TypeError('dist artifact upload must configure if string');
      assert.equal(distCondition, 'always()', 'dist artifact upload must always run');
      const distPath = distUpload.with?.path;
      if (typeof distPath !== 'string') throw new TypeError('dist artifact upload must configure path string');
      assert.ok(splitLines(distPath).includes('dist'), 'dist artifact path must include dist directory');
      const logUpload = expectUploadStep(buildSteps, 'build-log', 'build job must upload build log artifact');
      const logCondition = logUpload.if;
      if (typeof logCondition !== 'string') throw new TypeError('build log artifact upload must configure if string');
      assert.equal(logCondition, 'always()', 'build log artifact upload must always run');
      const logPath = logUpload.with?.path;
      if (typeof logPath !== 'string') throw new TypeError('build log artifact upload must configure path string');
      assert.ok(splitLines(logPath).includes('build.log'), 'build log artifact path must include build.log');
    } catch (error) {
      console.error('CI build workflow verification failed:', error);
      throw error;
    }
  });
});
function splitLines(input: string): string[] {
  return input.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
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
  if (!match) assert.fail('js-yaml must be present in pnpm store');
  const moduleDir = resolve(pnpmDir, match.name, 'node_modules', 'js-yaml');
  return require(moduleDir) as JsYamlModule;
}
async function loadWorkflow(): Promise<WorkflowYaml> {
  const { load } = await importJsYaml();
  const source = await readFile(workflowPath, 'utf8');
  const parsed = load(source) as WorkflowYaml | null;
  if (!parsed || typeof parsed !== 'object') throw new Error('workflow must parse to an object');
  return parsed as WorkflowYaml;
}
function expectJobSteps(job: WorkflowJob | undefined, message: string): StepConfig[] {
  if (!job) throw new Error(message);
  if (!Array.isArray(job.steps)) throw new Error('job.steps must be an array');
  return job.steps;
}
function expectUploadStep(steps: StepConfig[], name: string, message: string): UploadStep {
  const match = findUploadStep(steps, name);
  if (!match) throw new Error(message);
  return match;
}
