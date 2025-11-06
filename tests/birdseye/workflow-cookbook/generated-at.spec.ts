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

type CapsuleDocument = GeneratedDocument & {
  id?: unknown;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../../../Day8/workflow-cookbook/docs/birdseye');
const INDEX_PATH = resolve(ROOT, 'index.json');
const HOT_PATH = resolve(ROOT, 'hot.json');
const CAPSULE_PATH = resolve(ROOT, 'caps/README.md.json');

const SERIAL_PATTERN = /^\d{5}$/u;

describe('workflow-cookbook birdseye generated_at serials', () => {
  test('index, hot, and README capsule share a five-digit serial token', async () => {
    const [indexRaw, hotRaw, capsuleRaw] = await Promise.all([
      readFile(INDEX_PATH, 'utf8'),
      readFile(HOT_PATH, 'utf8'),
      readFile(CAPSULE_PATH, 'utf8'),
    ]);

    const indexDoc = JSON.parse(indexRaw) as GeneratedDocument;
    const hotDoc = JSON.parse(hotRaw) as GeneratedDocument;
    const capsuleDoc = JSON.parse(capsuleRaw) as CapsuleDocument;

    assert.strictEqual(
      typeof indexDoc.generated_at,
      'string',
      'index generated_at must be a string',
    );

    assert.ok(
      SERIAL_PATTERN.test(indexDoc.generated_at as string),
      `index generated_at must match ${SERIAL_PATTERN}`,
    );

    assert.strictEqual(
      typeof hotDoc.generated_at,
      'string',
      'hot generated_at must be a string',
    );

    assert.ok(
      SERIAL_PATTERN.test(hotDoc.generated_at as string),
      `hot generated_at must match ${SERIAL_PATTERN}`,
    );

    assert.strictEqual(
      typeof capsuleDoc.generated_at,
      'string',
      'capsule generated_at must be a string',
    );

    assert.ok(
      SERIAL_PATTERN.test(capsuleDoc.generated_at as string),
      `capsule generated_at must match ${SERIAL_PATTERN}`,
    );

    const serials = new Set([
      indexDoc.generated_at as string,
      hotDoc.generated_at as string,
      capsuleDoc.generated_at as string,
    ]);

    assert.strictEqual(
      serials.size,
      1,
      `generated_at mismatch detected: ${Array.from(serials).join(', ')}`,
    );
  });
});
