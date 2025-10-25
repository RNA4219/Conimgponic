/// <reference types="node" />

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

type PackageJson = {
  readonly version?: unknown;
};

const MINIMUM_MAJOR = 0;
const MINIMUM_MINOR = 25;
const MINIMUM_PATCH = 0;

const rootRequire = createRequire(import.meta.url);
const vitePackagePath = rootRequire.resolve('vite/package.json');
const viteRequire = createRequire(vitePackagePath);

function parseVersion(version: string): readonly [number, number, number] {
  const [core] = version.split('-', 1);
  const segments = core.split('.');

  if (segments.length < 3) {
    assert.fail(`esbuild version must include major, minor, and patch segments (received: ${version})`);
  }

  const numbers = segments.slice(0, 3).map((segment, index) => {
    const value = Number.parseInt(segment, 10);

    if (!Number.isInteger(value)) {
      assert.fail(`esbuild version segment #${index + 1} must be an integer (received: ${segment})`);
    }

    return value;
  });

  return [numbers[0]!, numbers[1]!, numbers[2]!];
}

function isAtLeastMinimum(version: readonly [number, number, number]): boolean {
  const [major, minor, patch] = version;

  if (major !== MINIMUM_MAJOR) {
    return major > MINIMUM_MAJOR;
  }

  if (minor !== MINIMUM_MINOR) {
    return minor > MINIMUM_MINOR;
  }

  return patch >= MINIMUM_PATCH;
}

describe('build toolchain dependencies', () => {
  test('esbuild is patched against GHSA-67mh-4wv8-2f99', () => {
    const packageJson = viteRequire('esbuild/package.json') as PackageJson;
    const { version } = packageJson;

    if (typeof version !== 'string') {
      throw new TypeError('esbuild/package.json must expose a string version');
    }

    const parsed = parseVersion(version);
    assert.ok(
      isAtLeastMinimum(parsed),
      `esbuild version must be at least ${MINIMUM_MAJOR}.${MINIMUM_MINOR}.${MINIMUM_PATCH} (received: ${version})`,
    );
  });
});
