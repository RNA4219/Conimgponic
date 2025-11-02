/// <reference types="node" />
process.env.TS_NODE_COMPILER_OPTIONS ??= JSON.stringify({ moduleResolution: 'bundler' });
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { loadWorkflow } from './utils/workflow-loader.js';
type WorkflowYaml = { jobs?: { build?: WorkflowJob } };
type WorkflowJob = { steps?: StepConfig[] };
type StepConfig = { name?: unknown; run?: unknown; uses?: unknown; with?: unknown };
type UploadStep = StepConfig & {
  uses: string;
  with?: { name?: unknown; path?: unknown; ['if-no-files-found']?: unknown };
  if?: unknown;
};
describe('ci workflow build job', () => {
  test('build job runs pnpm build and uploads artifacts', async () => {
    try {
      const workflow = await loadWorkflow();
      const buildSteps = expectJobSteps(workflow.jobs?.build, 'build job must exist');
      const buildRun = buildSteps.find(
        (step) => typeof step.run === 'string' && step.run.includes('pnpm --reporter ndjson -s build'),
      );
      if (!buildRun || typeof buildRun.run !== 'string') throw new Error('build job must run pnpm --reporter ndjson -s build');
      const installExpectation = await loadBuildInstallExpectation();
      const canonicalInstall = canonicalizeInstallCommand(installExpectation);
      const buildRunIndex = buildSteps.indexOf(buildRun);
      const installStep = findInstallStep(buildSteps, canonicalInstall, buildRunIndex);
      if (!installStep) {
        throw new Error('build job must install dependencies before running build');
      }
      const distUpload = expectUploadStep(buildSteps, 'dist', 'build job must upload dist artifact');
      const distCondition = distUpload.if;
      if (typeof distCondition !== 'string') throw new TypeError('dist artifact upload must configure if string');
      assert.equal(distCondition, 'always()', 'dist artifact upload must always run');
      const distConfig = distUpload.with;
      if (!distConfig || typeof distConfig !== 'object') throw new TypeError('dist artifact upload must configure with object');
      const distRecord = distConfig as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(distRecord, 'if-no-files-found')) {
        throw new TypeError('dist artifact upload must configure if-no-files-found');
      }
      const distPath = (distRecord as { path?: unknown }).path;
      if (typeof distPath !== 'string') throw new TypeError('dist artifact upload must configure path string');
      assert.ok(splitLines(distPath).includes('dist'), 'dist artifact path must include dist directory');
      const distIfNoFilesFound = distRecord['if-no-files-found'];
      if (typeof distIfNoFilesFound !== 'string') {
        throw new TypeError('dist artifact upload must configure if-no-files-found string');
      }
      assert.equal(
        distIfNoFilesFound,
        'error',
        "dist artifact upload must configure if-no-files-found as 'error'",
      );
      const logUpload = expectUploadStep(buildSteps, 'build-log', 'build job must upload build log artifact');
      const logCondition = logUpload.if;
      if (typeof logCondition !== 'string') throw new TypeError('build log artifact upload must configure if string');
      assert.equal(logCondition, 'always()', 'build log artifact upload must always run');
      const logConfig = logUpload.with;
      if (!logConfig || typeof logConfig !== 'object') {
        throw new TypeError('build log artifact upload must configure with object');
      }
      const logPath = (logConfig as { path?: unknown }).path;
      if (typeof logPath !== 'string') throw new TypeError('build log artifact upload must configure path string');
      assert.ok(splitLines(logPath).includes('build.log'), 'build log artifact path must include build.log');
      const logIfNoFiles = (logConfig as { 'if-no-files-found'?: unknown })['if-no-files-found'];
      if (typeof logIfNoFiles !== 'string') {
        throw new TypeError('build log artifact upload must configure if-no-files-found string');
      }
      assert.equal(logIfNoFiles, 'error', 'build log artifact upload must fail when build.log is missing');
    } catch (error) {
      console.error('CI build workflow verification failed:', error);
      throw error;
    }
  });

  test('build job install command matches CI spec first command', async () => {
    const workflow = await loadWorkflow();
    const buildSteps = expectJobSteps(workflow.jobs?.build, 'build job must exist');
    const buildRun = buildSteps.find(
      (step) => typeof step.run === 'string' && step.run.includes('pnpm --reporter ndjson -s build'),
    );
    if (!buildRun || typeof buildRun.run !== 'string') throw new Error('build job must run pnpm --reporter ndjson -s build');
    const buildRunIndex = buildSteps.indexOf(buildRun);
    if (buildRunIndex < 0) throw new Error('build job must define build step index');
    const installExpectation = await loadBuildInstallExpectation();
    const installStep = findInstallStep(buildSteps, installExpectation, buildRunIndex);
    if (!installStep || typeof installStep.run !== 'string') {
      throw new Error('build job must include install step defined by CI spec');
    }
    const normalizedRun = installStep.run.trim().replace(/\s+/gu, ' ');
    assert.ok(
      normalizedRun.startsWith(installExpectation),
      `build job install step must start with CI spec command "${installExpectation}"`,
    );
  });
});
async function loadBuildInstallExpectation(): Promise<string> {
  const specSource = await readFile(new URL('../../docs/CI-SPEC.md', import.meta.url), 'utf8');
  const buildLine = specSource
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.startsWith('4. **build**:'));
  if (!buildLine) throw new Error('CI spec must define build job requirements');
  const inlineCommands = Array.from(buildLine.matchAll(/`([^`]+)`/gu), (match) => match[1]?.trim()).filter(Boolean);
  if (inlineCommands.length === 0) {
    throw new Error('CI spec build job must document expected commands');
  }
  const [pipeline] = inlineCommands;
  if (!pipeline) throw new Error('CI spec build job command pipeline must be present');
  const [firstCommand] = pipeline
    .split('&&')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (!firstCommand) {
    throw new Error('CI spec build job must specify install command before build');
  }
  return normalizeInstallCommand(firstCommand);
}
function canonicalizeInstallCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed.startsWith('pnpm ')) {
    throw new Error('build install expectation must start with pnpm command');
  }
  const tokens = trimmed.split(/\s+/u);
  if (tokens.length < 2) {
    throw new Error('build install expectation must include subcommand');
  }
  const subcommand = tokens[1];
  if (subcommand === 'i') {
    tokens[1] = 'install';
  } else if (subcommand !== 'install') {
    throw new Error('build install expectation must resolve to pnpm install');
  }
  return `${tokens[0]} ${tokens[1]}`;
}
function normalizeInstallCommand(command: string): string {
  const canonical = canonicalizeInstallCommand(command);
  const normalized = command.replace(/\s+/gu, ' ').trim();
  const tokens = normalized.split(' ');
  const extras = tokens.slice(2).filter((token) => token.length > 0);
  if (!extras.includes('--frozen-lockfile')) {
    extras.push('--frozen-lockfile');
  }
  const dedupedExtras: string[] = [];
  const seen = new Set<string>();
  for (const token of extras) {
    if (seen.has(token)) continue;
    seen.add(token);
    dedupedExtras.push(token);
  }
  return [canonical, ...dedupedExtras].join(' ');
}
function findInstallStep(steps: StepConfig[], canonicalInstall: string, buildRunIndex: number): StepConfig | undefined {
  if (buildRunIndex < 0) return undefined;
  const slice = steps.slice(0, buildRunIndex);
  return slice.find((step) => {
    if (!step || typeof step !== 'object') return false;
    if (typeof step.run !== 'string') return false;
    const normalizedRun = step.run.replace(/\s+/gu, ' ').trim();
    return normalizedRun.includes(canonicalInstall);
  });
}
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
