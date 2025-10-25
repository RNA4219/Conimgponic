/// <reference types="node" />
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

type WorkflowYaml = { on?: OnDefinition };
type OnDefinition = { pull_request?: unknown; push?: PushDefinition; schedule?: ScheduleEntry[] };
type PushDefinition = { branches?: unknown };
type ScheduleEntry = { cron?: unknown };
type JsYamlModule = { load: (input: string) => unknown };

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '..', '..');
const workflowPath = resolve(repoRoot, '.github', 'workflows', 'ci.yml');
const require = createRequire(import.meta.url);
const { load } = await importJsYaml();

describe('ci workflow triggers', () => {
  test('match CI spec trigger requirements', async () => {
    try {
      const parsed = load(await readFile(workflowPath, 'utf8')) as unknown;
      if (!isRecord(parsed)) assert.fail('workflow must parse into an object');
      const triggers = (parsed as WorkflowYaml).on;
      if (!isRecord(triggers)) assert.fail('workflow.on must be defined');
      assert.ok(Object.prototype.hasOwnProperty.call(triggers, 'pull_request'), 'workflow.on must define pull_request trigger');
      const push = triggers.push;
      if (!isRecord(push)) assert.fail('workflow.on.push must be an object');
      assert.ok(normalizeBranches(push.branches).includes('main'), 'workflow.on.push.branches must include main');
      const schedule = triggers.schedule;
      if (!Array.isArray(schedule)) assert.fail('workflow.on.schedule must be an array');
      const cronExpressions = schedule.map((entry, index) => {
        if (!isRecord(entry)) assert.fail(`workflow.on.schedule entry #${index + 1} must be an object`);
        const cron = entry.cron;
        if (typeof cron !== 'string') assert.fail(`workflow.on.schedule entry #${index + 1} must define cron string`);
        const trimmed = cron.trim();
        assert.notStrictEqual(trimmed, '', `workflow.on.schedule entry #${index + 1} cron must be non-empty`);
        return trimmed;
      });
      assert.ok(cronExpressions.includes('0 3 * * *'), "workflow.on.schedule must include cron expression '0 3 * * *'");
    } catch (error) {
      console.error('CI workflow trigger verification failed:', error);
      throw error;
    }
  });
});

function normalizeBranches(branches: unknown): string[] {
  if (typeof branches === 'string') {
    const branch = branches.trim();
    assert.notStrictEqual(branch, '', 'workflow.on.push.branches string must be non-empty');
    return [branch];
  }
  if (Array.isArray(branches)) {
    const values = branches.map((entry, index) => {
      if (typeof entry !== 'string') assert.fail(`workflow.on.push.branches entry #${index + 1} must be a string`);
      const branch = entry.trim();
      assert.notStrictEqual(branch, '', `workflow.on.push.branches entry #${index + 1} must be non-empty`);
      return branch;
    });
    assert.ok(values.length > 0, 'workflow.on.push.branches must include at least one branch');
    return values;
  }
  assert.fail('workflow.on.push.branches must be a string or an array of strings');
}

function isRecord(value: unknown): value is Record<string | number | symbol, unknown> {
  return typeof value === 'object' && value !== null;
}

async function importJsYaml(): Promise<JsYamlModule> {
  try {
    return require('js-yaml') as JsYamlModule;
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  const pnpmDir = resolve(repoRoot, 'node_modules', '.pnpm');
  const entries = await readdir(pnpmDir, { withFileTypes: true });
  const match = entries.find((entry) => entry.isDirectory() && entry.name.startsWith('js-yaml@'));
  if (!match) assert.fail('js-yaml must be present in pnpm store');
  const moduleDir = resolve(pnpmDir, match.name, 'node_modules', 'js-yaml');
  const moduleRequire = createRequire(resolve(moduleDir, 'index.js'));
  return moduleRequire('.') as JsYamlModule;
}

type NodeError = Error & { code?: string };
function isNodeError(error: unknown): error is NodeError {
  return error instanceof Error && 'code' in error;
}
