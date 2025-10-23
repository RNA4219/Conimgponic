/// <reference types="node" />

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
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
const { load } = await importJsYaml();

type JsYamlModule = {
  load: (input: string) => unknown;
};

describe('security-audit workflow schedule', () => {
  test('defines a cron schedule trigger', async () => {
    try {
      const source = await readFile(workflowPath, 'utf8');
      const onSection = extractOnSection(source);
      const parsed = load(onSection) as unknown;

      if (!parsed || typeof parsed !== 'object') {
        assert.fail('on section should parse into an object');
      }

      const workflow = parsed as WorkflowYaml;
      if (!workflow.on || typeof workflow.on !== 'object') {
        assert.fail('workflow.on must be defined');
      }

      const schedule = workflow.on.schedule;
      if (!Array.isArray(schedule)) {
        assert.fail('workflow.on.schedule must be an array');
      }

      if (schedule.length === 0) {
        assert.fail('workflow.on.schedule must include at least one entry');
      }

      schedule.forEach((entry, index) => {
        if (!isRecord(entry)) {
          assert.fail(`schedule entry #${index + 1} must be an object`);
        }

        if (typeof entry.cron !== 'string') {
          assert.fail(`schedule entry #${index + 1} must set cron`);
        }

        const cron = entry.cron.trim();
        assert.notStrictEqual(cron, '', `schedule entry #${index + 1} cron must be non-empty`);
        const segments = cron.split(/\s+/).filter(Boolean);
        assert.strictEqual(
          segments.length,
          5,
          `schedule entry #${index + 1} cron must include 5 space-separated fields`
        );
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

async function importJsYaml(): Promise<JsYamlModule> {
  try {
    return require('js-yaml') as JsYamlModule;
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
  }

  const pnpmDir = resolve(repoRoot, 'node_modules', '.pnpm');
  const entries = await readdir(pnpmDir, { withFileTypes: true });
  const match = entries.find((entry) => entry.isDirectory() && entry.name.startsWith('js-yaml@'));

  if (!match) {
    assert.fail('js-yaml must be present in pnpm store');
  }

  const moduleDir = resolve(pnpmDir, match.name, 'node_modules', 'js-yaml');
  const moduleRequire = createRequire(resolve(moduleDir, 'index.js'));
  return moduleRequire('.') as JsYamlModule;
}

type NodeError = Error & {
  code?: string;
};

function isNodeError(error: unknown): error is NodeError {
  return error instanceof Error && 'code' in error;
}
