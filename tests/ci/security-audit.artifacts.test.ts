/// <reference types="node" />

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '..', '..');
const workflowPath = resolve(repoRoot, '.github', 'workflows', 'security-audit.yml');
const require = createRequire(import.meta.url);

type WorkflowYaml = {
  jobs?: {
    audit?: WorkflowJob;
  };
};

type WorkflowJob = {
  steps?: StepConfig[];
};

type StepConfig = {
  name?: unknown;
  uses?: unknown;
  with?: unknown;
};

type UploadStep = StepConfig & {
  uses: string;
  with?: {
    path?: unknown;
    name?: unknown;
    ['if-no-files-found']?: unknown;
  };
};

type UploadConfig = NonNullable<UploadStep['with']>;

type JsYamlModule = {
  load: (input: string) => unknown;
};

describe('security-audit workflow artifacts', () => {
  test('uploads required audit artifacts with failure on missing files', async () => {
    try {
      const workflow = await loadWorkflow();
      const auditJob = workflow.jobs?.audit;
      if (!auditJob) {
        assert.fail('security-audit workflow must define audit job');
      }

      const steps = auditJob.steps;
      if (!Array.isArray(steps)) {
        assert.fail('audit job steps must be an array');
      }

      const auditReportUpload = expectUploadStepContainingPath(steps, 'audit-report.json');
      assert.strictEqual(
        readIfNoFilesFound(auditReportUpload),
        'error',
        'audit report upload must fail when audit-report.json is missing',
      );

      const auditSummaryUpload = expectUploadStepContainingPath(steps, 'audit-summary.json');
      assert.strictEqual(
        readIfNoFilesFound(auditSummaryUpload),
        'error',
        'audit summary upload must fail when audit-summary.json is missing',
      );

      const osvUpload = expectUploadStepContainingPath(steps, 'osv-report.json');
      assert.strictEqual(
        readIfNoFilesFound(osvUpload),
        'warn',
        'osv report upload must warn when osv-report.json is missing',
      );
    } catch (error) {
      console.error('Artifact verification failed:', error);
      throw error;
    }
  });
});

async function loadWorkflow(): Promise<WorkflowYaml> {
  const { load } = await importJsYaml();
  const source = await readFile(workflowPath, 'utf8');
  const parsed = load(source);
  if (!parsed || typeof parsed !== 'object') {
    assert.fail('workflow must parse into an object');
  }
  return parsed as WorkflowYaml;
}

async function importJsYaml(): Promise<JsYamlModule> {
  const pnpmDir = resolve(repoRoot, 'node_modules', '.pnpm');
  const entries = await readdir(pnpmDir, { withFileTypes: true });
  const match = entries.find((entry) => entry.isDirectory() && entry.name.startsWith('js-yaml@'));
  if (!match) {
    assert.fail('js-yaml package must be installed');
  }
  const moduleDir = resolve(pnpmDir, match.name, 'node_modules', 'js-yaml');
  return require(moduleDir) as JsYamlModule;
}

function expectUploadStepContainingPath(steps: StepConfig[], expected: string): UploadStep {
  const upload = steps.find((step): step is UploadStep => {
    if (typeof step.uses !== 'string') {
      return false;
    }
    if (step.uses.trim() !== 'actions/upload-artifact@v4') {
      return false;
    }
    const config = step.with;
    if (!config || typeof config !== 'object') {
      return false;
    }
    const uploadConfig = config as UploadConfig;
    const paths = normalizePaths(uploadConfig.path);
    return paths.includes(expected);
  });

  if (!upload) {
    assert.fail(`expected upload step containing ${expected}`);
  }

  return upload;
}

function normalizePaths(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0);
  }

  return [];
}

function readIfNoFilesFound(step: UploadStep): string {
  const config = step.with;
  if (!config || typeof config !== 'object') {
    assert.fail('upload step must define with configuration');
  }
  const uploadConfig = config as UploadConfig;
  const value = uploadConfig['if-no-files-found'];
  if (typeof value !== 'string') {
    assert.fail('upload step must configure if-no-files-found as string');
  }
  return value.trim();
}
