/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listUploadArtifactPaths } from './utils/workflow-loader.js';

type JobName = 'sbom' | 'audit' | 'golden';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '..', '..');
const specPath = resolve(repoRoot, 'docs', 'CI-SPEC.md');
const ARTIFACT_JOB_MAPPING: Record<string, JobName> = {
  'sbom.json': 'sbom',
  'audit-report.json': 'audit',
  'golden-diff.txt': 'golden',
};

describe('CI workflow artifacts', () => {
  test('workflow artifact uploads must cover documented outputs', async () => {
    const artifacts = await readDocumentedArtifacts();
    assert.ok(artifacts.length > 0, 'CI-SPEC must enumerate artifacts in "## 4. 成果物" section');

    const uploads = new Map<JobName, readonly string[]>();
    for (const job of new Set<JobName>(artifacts.map(resolveArtifactJob))) {
      uploads.set(job, await listUploadArtifactPaths(job));
    }

    const missing = artifacts
      .map((artifact) => {
        const job = resolveArtifactJob(artifact);
        const entries = uploads.get(job) ?? [];
        return entries.some((entry) => entry === artifact || entry.endsWith(`/${artifact}`))
          ? null
          : `${artifact} (job: ${job})`;
      })
      .filter((value): value is string => value !== null);

    if (missing.length !== 0) {
      assert.fail([
        'Workflow must upload all documented artifacts',
        'missing artifacts:',
        ...missing.map((entry) => `  - ${entry}`),
      ].join('\n'));
    }
  });
});

async function readDocumentedArtifacts(): Promise<string[]> {
  const spec = await readFile(specPath, 'utf8');
  const heading = '## 4. 成果物';
  const headingIndex = spec.indexOf(heading);
  assert.ok(headingIndex !== -1, 'CI-SPEC must include "## 4. 成果物" section');
  const rest = spec.slice(headingIndex + heading.length);
  const endIndex = rest.search(/\n##\s+/u);
  const section = endIndex === -1 ? rest : rest.slice(0, endIndex);
  const artifactMatch = section.match(/`artifact:\s*([^`]+)`/u);
  assert.ok(artifactMatch, 'CI-SPEC artifact section must contain inline artifact list');
  return artifactMatch[1]
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function resolveArtifactJob(name: string): JobName {
  const job = ARTIFACT_JOB_MAPPING[name];
  assert.ok(job, `No job mapping defined for artifact "${name}"`);
  return job;
}
