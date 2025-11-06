/// <reference types="node" />
process.env.TS_NODE_COMPILER_OPTIONS ??= JSON.stringify({ moduleResolution: 'bundler' });

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

type GeneratedDocument = {
  generated_at?: unknown;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BIRDSEYE_DIR = resolve(__dirname, '../../Day8/docs/birdseye');
const INDEX_PATH = resolve(BIRDSEYE_DIR, 'index.json');
const HOT_PATH = resolve(BIRDSEYE_DIR, 'hot.json');

describe('birdseye generated_at sync', () => {
  test('index.json and hot.json share the same serial token', async () => {
    const [indexRaw, hotRaw] = await Promise.all([
      readFile(INDEX_PATH, 'utf8'),
      readFile(HOT_PATH, 'utf8'),
    ]);

    const indexData = JSON.parse(indexRaw) as GeneratedDocument;
    const hotData = JSON.parse(hotRaw) as GeneratedDocument;

    assert.strictEqual(
      typeof indexData.generated_at,
      'string',
      'index.json generated_at must be a string',
    );

    assert.strictEqual(
      typeof hotData.generated_at,
      'string',
      'hot.json generated_at must be a string',
    );

    assert.strictEqual(
      indexData.generated_at,
      hotData.generated_at,
      `generated_at mismatch: index=${String(indexData.generated_at)} hot=${String(hotData.generated_at)}`,
    );
  });
});
