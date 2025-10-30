/// <reference types="node" />
process.env.TS_NODE_COMPILER_OPTIONS ??= JSON.stringify({ moduleResolution: 'bundler' });
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadWorkflow } from './utils/workflow-loader.js';

type WorkflowYaml = { jobs?: { license?: WorkflowJob } };
type WorkflowJob = { steps?: StepConfig[]; needs?: JobNeeds };
type StepConfig = { name?: unknown; run?: unknown; uses?: unknown; with?: unknown; if?: unknown };
type UploadStep = StepConfig & {
  uses: string;
  with?: { name?: unknown; path?: unknown; ['if-no-files-found']?: unknown };
};
type JobNeeds = string | string[] | undefined;
describe('ci workflow license job', () => {
  test('runs license verification and uploads required artifacts', async () => {
    try {
      const workflow = await loadWorkflow();
      const steps = expectJobSteps(workflow.jobs?.license, 'license job must exist');

      const runStep = steps.find((step) => typeof step.run === 'string' && step.run.includes('license:check'));
      if (!runStep || typeof runStep.run !== 'string') {
        throw new Error('license job must run pnpm -s license:check');
      }
      assert.ok(runStep.run.includes('pnpm -s license:check'), 'license job must invoke pnpm -s license:check');

      const upload = expectUploadStep(steps, 'license-artifacts', 'license job must upload license artifacts');
      if (upload.if !== 'always()') {
        throw new Error('license artifact upload must always run');
      }
      const uploadIfNoFilesFound = upload.with?.['if-no-files-found'];
      if (typeof uploadIfNoFilesFound !== 'string') {
        throw new TypeError('license artifact upload must configure if-no-files-found policy');
      }
      assert.equal(uploadIfNoFilesFound, 'error', 'license artifact upload must fail when files are missing');
      const uploadPath = upload.with?.path;
      if (typeof uploadPath !== 'string') {
        throw new TypeError('license artifact upload must configure string path');
      }

      const entries = parsePathEntries(uploadPath);
      for (const expected of ['license-report.json', 'license-summary.json']) {
        assert.ok(entries.includes(expected), `license artifact upload must include ${expected}`);
      }
    } catch (error) {
      console.error('CI license workflow verification failed:', error);
      throw error;
    }
  });

  test('depends on sbom job output', async () => {
    const workflow = await loadWorkflow();
    const licenseJob = workflow.jobs?.license;
    if (!licenseJob) {
      throw new Error('license job must exist');
    }
    const needs = normalizeJobNeeds(licenseJob.needs);
    assert.ok(needs.includes('sbom'), 'license job must depend on sbom job');
  });
});

function parsePathEntries(input: string): string[] {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function expectJobSteps(job: WorkflowJob | undefined, message: string): StepConfig[] {
  if (!job) throw new Error(message);
  if (!Array.isArray(job.steps)) throw new Error('job.steps must be an array');
  return job.steps;
}

function expectUploadStep(steps: StepConfig[], name: string, message: string): UploadStep {
  const match = steps.find((step): step is UploadStep => {
    if (typeof step.uses !== 'string') return false;
    if (step.uses.trim() !== 'actions/upload-artifact@v4') return false;
    const config = step.with;
    if (!config || typeof config !== 'object') return false;
    return 'name' in config && (config as { name?: unknown }).name === name;
  });
  if (!match) {
    throw new Error(message);
  }
  return match;
}

function normalizeJobNeeds(input: JobNeeds): string[] {
  if (Array.isArray(input)) return input.map((value) => `${value}`.trim()).filter((value) => value.length > 0);
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  return [];
}
