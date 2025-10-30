/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadWorkflow } from './utils/workflow-loader.js';

type WorkflowYaml = { on?: OnDefinition };
type OnDefinition = { pull_request?: unknown; push?: PushDefinition; schedule?: ScheduleEntry[] };
type PushDefinition = { branches?: unknown };
type ScheduleEntry = { cron?: unknown };
describe('ci workflow triggers', () => {
  test('match CI spec trigger requirements', async () => {
    try {
      const workflow = (await loadWorkflow()) as WorkflowYaml;
      const triggers = workflow.on;
      if (!isRecord(triggers)) assert.fail('workflow.on must be defined');
      assert.ok(Object.prototype.hasOwnProperty.call(triggers, 'pull_request'), 'workflow.on must define pull_request trigger');
      const pullRequest = triggers.pull_request;
      if (!isRecord(pullRequest)) assert.fail('workflow.on.pull_request must be an object');
      assert.ok(
        normalizeBranches(pullRequest.branches, 'workflow.on.pull_request.branches').includes('main'),
        'workflow.on.pull_request.branches must include main',
      );
      const push = triggers.push;
      if (!isRecord(push)) assert.fail('workflow.on.push must be an object');
      assert.ok(
        normalizeBranches(push.branches, 'workflow.on.push.branches').includes('main'),
        'workflow.on.push.branches must include main',
      );
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

function normalizeBranches(branches: unknown, context: string): string[] {
  if (typeof branches === 'string') {
    const branch = branches.trim();
    assert.notStrictEqual(branch, '', `${context} string must be non-empty`);
    return [branch];
  }
  if (Array.isArray(branches)) {
    const values = branches.map((entry, index) => {
      if (typeof entry !== 'string') assert.fail(`${context} entry #${index + 1} must be a string`);
      const branch = entry.trim();
      assert.notStrictEqual(branch, '', `${context} entry #${index + 1} must be non-empty`);
      return branch;
    });
    assert.ok(values.length > 0, `${context} must include at least one branch`);
    return values;
  }
  assert.fail(`${context} must be a string or an array of strings`);
}

function isRecord(value: unknown): value is Record<string | number | symbol, unknown> {
  return typeof value === 'object' && value !== null;
}
