import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { createRequire } from 'node:module';

type WorkflowYaml = {
  on?: {
    schedule?: ScheduleEntry[];
  };
};

type ScheduleEntry = {
  cron?: unknown;
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '..', '..');
const workflowPath = resolve(repoRoot, '.github', 'workflows', 'security-audit.yml');
const require = createRequire(import.meta.url);
const { load } = require('js-yaml') as JsYamlModule;

type JsYamlModule = {
  load: (input: string) => unknown;
};

describe('security-audit workflow schedule', () => {
  test('defines a cron schedule trigger', async () => {
    try {
      const source = await readFile(workflowPath, 'utf8');
      const onSection = extractOnSection(source);
      const parsed = load(onSection) as unknown;

      assert.ok(parsed && typeof parsed === 'object', 'on section should parse into an object');

      const workflow = parsed as WorkflowYaml;
      assert.ok(workflow.on && typeof workflow.on === 'object', 'workflow.on must be defined');

      const schedule = workflow.on.schedule;
      assert.ok(Array.isArray(schedule), 'workflow.on.schedule must be an array');
      assert.ok(schedule.length > 0, 'workflow.on.schedule must include at least one entry');

      schedule.forEach((entry, index) => {
        assert.ok(isRecord(entry), `schedule entry #${index + 1} must be an object`);

        if (typeof entry.cron !== 'string') {
          assert.fail(`schedule entry #${index + 1} must set cron`);
        }

        const cron = entry.cron.trim();
        assert.notStrictEqual(cron, '', `schedule entry #${index + 1} cron must be non-empty`);
      });
    } catch (error) {
      console.error('Failed to verify schedule trigger:', error);
      throw error;
    }
  });
});

function extractOnSection(source: string): string {
  const lines = source.split(/\r?\n/);
  const collected: string[] = [];
  let capturing = false;

  for (const line of lines) {
    if (!capturing) {
      if (line.trimStart().startsWith('on:') && !line.startsWith(' ')) {
        collected.push('on:');
        capturing = true;
      }
      continue;
    }

    if (!line.startsWith(' ')) {
      break;
    }

    collected.push(line);
  }

  assert.ok(collected.length > 1, 'workflow must define an on section');

  return `${collected.join('\n')}\n`;
}

function isRecord(value: unknown): value is ScheduleEntry {
  return typeof value === 'object' && value !== null;
}
