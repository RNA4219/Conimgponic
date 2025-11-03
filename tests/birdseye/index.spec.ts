/// <reference types="node" />
process.env.TS_NODE_COMPILER_OPTIONS ??= JSON.stringify({ moduleResolution: 'bundler' });

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

type BirdseyeIndex = {
  edges: unknown;
  nodes: Record<string, unknown>;
};

type Edge = [string, string];

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const INDEX_PATH = resolve(__dirname, '../../Day8/docs/birdseye/index.json');

describe('birdseye index schema', () => {
  test('edges are pairs linking existing nodes', async () => {
    const raw = await readFile(INDEX_PATH, 'utf8');
    const parsed = JSON.parse(raw) as BirdseyeIndex;

    assert.ok(Array.isArray(parsed.edges), 'edges must be an array');

    const nodeKeys = new Set(Object.keys(parsed.nodes));

    for (const edge of parsed.edges as Edge[]) {
      assert.ok(Array.isArray(edge), 'edge entry must be an array');
      assert.strictEqual(edge.length, 2, `edge entry must contain exactly 2 items (actual: ${edge.length})`);

      for (const endpoint of edge) {
        assert.strictEqual(typeof endpoint, 'string', 'edge endpoint must be a string');
        assert.ok(nodeKeys.has(endpoint), `edge endpoint must exist in nodes map: ${endpoint}`);
      }
    }
  });
});
