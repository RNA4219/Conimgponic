/// <reference types="node" />
process.env.TS_NODE_COMPILER_OPTIONS ??= JSON.stringify({ moduleResolution: 'bundler' });

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CI_SPEC_PATH = resolve(__dirname, '../../docs/CI-SPEC.md');
const REQUIRED_LICENSES: string[] = [];

describe.skip('CI license allowlist documentation', () => {
  test('extracts documented allowlist entries from CI spec', async () => {
    const markdown = await readFile(CI_SPEC_PATH, 'utf8');
    const extracted = extractDocumentedLicenseAllowlist(markdown);

    for (const license of REQUIRED_LICENSES) {
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

  test('documents required license allowlist entries', () => {
    for (const license of REQUIRED_LICENSES) {
      assert.ok(
        DOCUMENTED_LICENSE_ALLOWLIST.has(license),
        `DOCUMENTED_LICENSE_ALLOWLIST must include required license ${license}`,
      );
    }
  });

  test('default license allowlist covers documented licenses', () => {
    for (const license of DOCUMENTED_LICENSE_ALLOWLIST) {
      assert.ok(
        DEFAULT_LICENSE_ALLOWLIST.has(license),
        `DEFAULT_LICENSE_ALLOWLIST must include documented license ${license}`,
      );
    }
  });

  test('validateDocumentedLicenseAllowlist enforces required licenses', () => {
    assert.throws(() => {
      validateDocumentedLicenseAllowlist(new Set(['MIT', 'Apache-2.0']));
    }, /must document required license allowlist entries/);

    assert.doesNotThrow(() => {
      validateDocumentedLicenseAllowlist(DOCUMENTED_LICENSE_ALLOWLIST);
    });
  });
});
