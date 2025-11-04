/// <reference types="node" />
process.env.TS_NODE_COMPILER_OPTIONS ??= JSON.stringify({ moduleResolution: 'bundler' });

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

type Edge = [string, string];
type BirdseyeIndex = { edges: unknown; nodes?: Record<string, unknown>; generated_at: unknown };

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BIRDSEYE_DIR = resolve(__dirname, '../../Day8/docs/birdseye');
const INDEX_PATH = join(BIRDSEYE_DIR, 'index.json');
const MERGE_SCRIPT = resolve(__dirname, '../../Day8/workflow-cookbook/tools/codemap/merge_index.py');

const normalizeIndex = (value: BirdseyeIndex) => {
  const edges = Array.isArray(value.edges)
    ? (value.edges as unknown[])
        .filter((entry): entry is Edge =>
          Array.isArray(entry) && entry.length === 2 && entry.every((item) => typeof item === 'string'),
        )
        .map((edge) => [edge[0], edge[1]] as Edge)
        .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
    : [];
  const nodes = Object.fromEntries(
    Object.entries(value.nodes ?? {})
      .filter(([key]) => typeof key === 'string')
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return { edges, nodes, generated_at: typeof value.generated_at === 'string' ? value.generated_at : '00000' };
};

describe('birdseye index shards', () => {
  test('merged shards equal aggregate index', async () => {
    const [aggregateRaw, mergeResult] = await Promise.all([
      fs.readFile(INDEX_PATH, 'utf8'),
      execFileAsync('python', [MERGE_SCRIPT, '--index', INDEX_PATH], { encoding: 'utf8' }),
    ]);
    const aggregateIndex = normalizeIndex(JSON.parse(aggregateRaw) as BirdseyeIndex);
    const mergedIndex = normalizeIndex(JSON.parse(mergeResult.stdout) as BirdseyeIndex);
    assert.deepStrictEqual(mergedIndex, aggregateIndex);
  });

  test('each shard respects 400 line limit', async () => {
    const shardFiles = (await fs.readdir(BIRDSEYE_DIR)).filter((entry) => entry.startsWith('index.') && entry !== 'index.json');
    assert.ok(shardFiles.length > 0, 'expected shard files to be present');
    for (const shard of shardFiles) {
      const content = await fs.readFile(join(BIRDSEYE_DIR, shard), 'utf8');
      const normalized = content.endsWith('\n') ? content.slice(0, -1) : content;
      const lineCount = normalized === '' ? 0 : normalized.split('\n').length;
      assert.ok(lineCount <= 400, `${shard} must not exceed 400 lines (actual: ${lineCount})`);
    }
  });
});
