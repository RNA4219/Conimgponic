/// <reference types="node" />
process.env.TS_NODE_COMPILER_OPTIONS ??= JSON.stringify({ moduleResolution: 'bundler' });

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_LICENSE_ALLOWLIST,
  DOCUMENTED_LICENSE_ALLOWLIST,
  extractDocumentedLicenseAllowlist,
  readDocumentedLicenseAllowlist,
} from '../../scripts/license/verify.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CI_SPEC_PATH = resolve(__dirname, '../../docs/CI-SPEC.md');

describe('CI license allowlist documentation', () => {
  test('extracts documented allowlist entries from CI spec', async () => {
    const markdown = await readFile(CI_SPEC_PATH, 'utf8');
    const extracted = extractDocumentedLicenseAllowlist(markdown);
    const minimal = ['MIT', 'BSD', 'Apache-2.0'];

    for (const license of minimal) {
      assert.ok(
        extracted.includes(license),
        `CI spec must document ${license} in license allowlist (actual: ${extracted.join(', ')})`,
      );
    }
  });

  test('provides documented allowlist from verify script', () => {
    const documented = readDocumentedLicenseAllowlist();
    assert.ok(documented.length > 0, 'documented allowlist must not be empty');
    assert.deepEqual(new Set(documented), DOCUMENTED_LICENSE_ALLOWLIST);
  });

  test('default license allowlist covers documented licenses', () => {
    for (const license of DOCUMENTED_LICENSE_ALLOWLIST) {
      assert.ok(
        DEFAULT_LICENSE_ALLOWLIST.has(license),
        `DEFAULT_LICENSE_ALLOWLIST must include documented license ${license}`,
      );
    }
  });
});
