/// <reference types="node" />
process.env.TS_NODE_COMPILER_OPTIONS ??= JSON.stringify({ moduleResolution: 'bundler' });

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const BIRDSEYE_ROOT = resolve(REPO_ROOT, 'Day8/docs/birdseye');

async function assertPathExists(relativePath: string, context: string): Promise<void> {
  const fullPath = resolve(REPO_ROOT, relativePath);
  try {
    await access(fullPath);
  } catch (error) {
    assert.fail(`${context}: missing ${relativePath}`);
  }
}

describe('birdseye path resolution', () => {
  test('index nodes and capsules reference existing files', async () => {
    const indexRaw = await readFile(resolve(BIRDSEYE_ROOT, 'index.json'), 'utf8');
    const indexData = JSON.parse(indexRaw) as {
      nodes?: Record<string, { caps?: string | undefined } | undefined>;
    };

    assert.ok(indexData.nodes, 'index nodes must be defined');

    const capsulePaths = new Set<string>();

    for (const [nodeId, payload] of Object.entries(indexData.nodes)) {
      assert.ok(payload, `node payload missing for ${nodeId}`);
      await assertPathExists(nodeId, 'index node');
      const capsule = payload?.caps;
      assert.ok(typeof capsule === 'string', `caps missing for ${nodeId}`);
      capsulePaths.add(capsule);
      await assertPathExists(capsule, `node capsule for ${nodeId}`);
    }

    const hotRaw = await readFile(resolve(BIRDSEYE_ROOT, 'hot.json'), 'utf8');
    const hotData = JSON.parse(hotRaw) as {
      entries?: Array<{ id?: string | undefined; caps?: string | undefined }>;
    };

    assert.ok(Array.isArray(hotData.entries), 'hot entries must be an array');

    for (const entry of hotData.entries) {
      assert.ok(entry, 'hot entry must be defined');
      assert.ok(typeof entry.id === 'string' && entry.id.length > 0, 'hot entry id must be string');
      await assertPathExists(entry.id, `hot entry ${entry.id}`);
      assert.ok(typeof entry.caps === 'string' && entry.caps.length > 0, `hot entry caps missing for ${entry.id}`);
      capsulePaths.add(entry.caps);
      await assertPathExists(entry.caps, `hot capsule for ${entry.id}`);
    }

    for (const capsulePath of capsulePaths) {
      const raw = await readFile(resolve(REPO_ROOT, capsulePath), 'utf8');
      const capsuleData = JSON.parse(raw) as {
        id?: string | undefined;
        deps_in?: string[] | undefined;
        deps_out?: string[] | undefined;
      };

      assert.ok(typeof capsuleData.id === 'string', `capsule id missing in ${capsulePath}`);
      await assertPathExists(capsuleData.id, `capsule id in ${capsulePath}`);

      for (const dependency of capsuleData.deps_in ?? []) {
        assert.ok(typeof dependency === 'string', `deps_in must contain strings in ${capsulePath}`);
        await assertPathExists(dependency, `deps_in ${dependency} in ${capsulePath}`);
      }

      for (const dependency of capsuleData.deps_out ?? []) {
        assert.ok(typeof dependency === 'string', `deps_out must contain strings in ${capsulePath}`);
        await assertPathExists(dependency, `deps_out ${dependency} in ${capsulePath}`);
      }
    }
  });
});
