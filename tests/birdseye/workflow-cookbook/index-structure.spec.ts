/// <reference types="node" />
process.env.TS_NODE_COMPILER_OPTIONS ??= JSON.stringify({ moduleResolution: 'bundler' });

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

type Edge = readonly [unknown, unknown];
type BirdseyeIndex = { readonly edges?: unknown };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const INDEX_PATH = resolve(__dirname, '../../../Day8/workflow-cookbook/docs/birdseye/index.json');

describe('workflow-cookbook birdseye index.json', () => {
  test('parses successfully and contains only string edge pairs', async () => {
    const raw = await fs.readFile(INDEX_PATH, 'utf8');
    let parsed: BirdseyeIndex | undefined;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(raw) as BirdseyeIndex;
    }, 'index.json must parse without syntax errors');
    assert.ok(parsed, 'parsed value must be defined');
    const { edges } = parsed;
    assert.ok(Array.isArray(edges), 'edges must be an array');
    (edges as Edge[]).forEach((edge, index) => {
      assert.ok(Array.isArray(edge), `edges[${index}] must be an array`);
      assert.strictEqual(edge.length, 2, `edges[${index}] must contain exactly two entries`);
      edge.forEach((node, nodeIndex) => {
        assert.strictEqual(typeof node, 'string', `edges[${index}][${nodeIndex}] must be a string`);
      });
    });
  });
});
