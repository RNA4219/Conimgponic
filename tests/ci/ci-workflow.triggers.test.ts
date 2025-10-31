/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import { loadWorkflow } from './utils/workflow-loader.js';

type WorkflowYaml = { on?: OnDefinition };
type OnDefinition = { pull_request?: unknown; push?: PushDefinition; schedule?: ScheduleEntry[] };
type PushDefinition = { branches?: unknown };
type ScheduleEntry = { cron?: unknown };

type WorkflowTriggers = {
  pullRequest: { branches: string[] };
  push: { branches: string[] };
  schedule: { crons: string[] };
};

type CiSpecTriggers = {
  pullRequest: { required: boolean; branches: string[] };
  push: { required: boolean; branches: string[] };
  schedule: { crons: string[] };
};

describe('ci workflow triggers', () => {
  test('CI spec documents workflow triggers', async () => {
    const spec = await loadCiSpecTriggerRequirements();

    assert.ok(spec.pullRequest.required, 'CI spec must mention pull_request trigger');
    assert.ok(
      spec.pullRequest.branches.includes('main'),
      'CI spec must document main branch for pull_request trigger',
    );
    assert.ok(spec.push.required, 'CI spec must mention push trigger');
    assert.ok(spec.push.branches.includes('main'), 'CI spec must document main branch for push trigger');
    assert.ok(
      spec.schedule.crons.includes('0 3 * * *'),
      "CI spec must document schedule cron expression '0 3 * * *'",
    );
  });

  test('match CI spec trigger requirements', async () => {
    try {
      const [spec, workflow] = await Promise.all([loadCiSpecTriggerRequirements(), loadWorkflow()]);
      const triggers = extractWorkflowTriggers(workflow as WorkflowYaml);

      assertSuperset(triggers.pullRequest.branches, spec.pullRequest.branches, 'workflow.on.pull_request.branches');
      assertSuperset(triggers.push.branches, spec.push.branches, 'workflow.on.push.branches');
      assertSuperset(triggers.schedule.crons, spec.schedule.crons, 'workflow.on.schedule');
    } catch (error) {
      console.error('CI workflow trigger verification failed:', error);
      throw error;
    }
  });
});

async function loadCiSpecTriggerRequirements(): Promise<CiSpecTriggers> {
  const markdown = await readFile(new URL('../../docs/CI-SPEC.md', import.meta.url), 'utf8');
  const section = extractMarkdownSection(markdown, '## 5. 実行タイミング');
  return parseCiSpecTriggers(section);
}

function extractWorkflowTriggers(workflow: WorkflowYaml): WorkflowTriggers {
  const triggers = workflow.on;
  if (!isRecord(triggers)) assert.fail('workflow.on must be defined');

  if (!Object.prototype.hasOwnProperty.call(triggers, 'pull_request')) {
    assert.fail('workflow.on must define pull_request trigger');
  }
  const pullRequest = triggers.pull_request;
  if (!isRecord(pullRequest)) assert.fail('workflow.on.pull_request must be an object');
  const pullRequestBranches = normalizeBranches(
    (pullRequest as { branches?: unknown }).branches,
    'workflow.on.pull_request.branches',
  );

  const push = triggers.push;
  if (!isRecord(push)) assert.fail('workflow.on.push must be an object');
  const pushBranches = normalizeBranches(push.branches, 'workflow.on.push.branches');

  const schedule = triggers.schedule;
  if (!Array.isArray(schedule)) assert.fail('workflow.on.schedule must be an array');
  const scheduleCrons = schedule.map((entry, index) => {
    if (!isRecord(entry)) assert.fail(`workflow.on.schedule entry #${index + 1} must be an object`);
    const cron = entry.cron;
    if (typeof cron !== 'string') assert.fail(`workflow.on.schedule entry #${index + 1} must define cron string`);
    return normalizeCronExpression(cron, index);
  });

  return {
    pullRequest: { branches: pullRequestBranches },
    push: { branches: pushBranches },
    schedule: { crons: scheduleCrons },
  };
}

function parseCiSpecTriggers(section: string): CiSpecTriggers {
  const lines = section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  let pullRequestRequired = false;
  const pullRequestBranches = new Set<string>();
  let pushRequired = false;
  const pushBranches = new Set<string>();
  const scheduleCrons = new Set<string>();

  for (const line of lines) {
    if (!line.startsWith('-')) continue;

    const segments = Array.from(line.matchAll(/`([^`]+)`/g), (match) => match[1]);
    const mentionsMain = line.includes('main');

    if (segments.includes('pull_request')) {
      pullRequestRequired = true;
      if (mentionsMain) pullRequestBranches.add('main');
    }
    if (segments.includes('push')) {
      pushRequired = true;
      if (mentionsMain) pushBranches.add('main');
    }
    if (segments.includes('schedule')) {
      for (const segment of segments) {
        if (segment === 'schedule') continue;
        if (isCronExpression(segment)) {
          scheduleCrons.add(normalizeCronExpression(segment));
        }
      }
      const derivedCron = deriveCronFromUtcTime(line);
      if (derivedCron) scheduleCrons.add(derivedCron);
    }
  }

  if (!pullRequestRequired) assert.fail('CI spec must mention `pull_request` trigger');
  if (!pushRequired) assert.fail('CI spec must mention `push` trigger');
  if (scheduleCrons.size === 0) assert.fail('CI spec must mention schedule cron expression');

  return {
    pullRequest: { required: pullRequestRequired, branches: toSortedArray(pullRequestBranches) },
    push: { required: pushRequired, branches: toSortedArray(pushBranches) },
    schedule: { crons: toSortedArray(scheduleCrons) },
  };
}

function extractMarkdownSection(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex === -1) assert.fail(`CI spec must include heading: ${heading}`);
  const sectionLines: string[] = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('## ')) break;
    sectionLines.push(line);
  }
  return sectionLines.join('\n');
}

function assertSuperset(actual: string[], expected: string[], context: string): void {
  for (const requirement of expected) {
    assert.ok(actual.includes(requirement), `${context} must include ${requirement}`);
  }
}

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

function normalizeCronExpression(cron: string, index?: number): string {
  const trimmed = cron.trim();
  const message =
    index === undefined
      ? 'cron expression must be non-empty'
      : `workflow.on.schedule entry #${index + 1} cron must be non-empty`;
  assert.notStrictEqual(trimmed, '', message);
  return trimmed.replace(/\s+/g, ' ');
}

function isCronExpression(value: string): boolean {
  return /^[*0-9?,/\s-]+$/.test(value);
}

function deriveCronFromUtcTime(line: string): string | undefined {
  const match = line.match(/UTC\s*(\d{1,2})[:：](\d{2})/i);
  if (!match) return undefined;
  const hour = Number.parseInt(match[1] ?? '', 10);
  const minute = Number.parseInt(match[2] ?? '', 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return undefined;
  return normalizeCronExpression(`${minute} ${hour} * * *`);
}

function toSortedArray(values: Set<string>): string[] {
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function isRecord(value: unknown): value is Record<string | number | symbol, unknown> {
  return typeof value === 'object' && value !== null;
}
