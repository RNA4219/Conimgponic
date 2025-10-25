/// <reference types="node" />

process.env.TS_NODE_COMPILER_OPTIONS ??= JSON.stringify({ moduleResolution: 'bundler' });

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
  scripts?: Record<string, string>;
};

const ensureCommand =
  "node --input-type=module --eval \"import { mkdirSync } from 'node:fs'; const dir = process.argv.at(-1); if (!dir) throw new Error('missing dir'); mkdirSync(dir, { recursive: true });\"";

const resolveScript = (name: string): string => {
  const scripts = packageJson.scripts;
  assert.ok(scripts, 'package.json.scripts is missing');
  const script = scripts[name];
  assert.ok(script, `script ${name} is missing`);
  return script;
};

test('test:coverage script prepares coverage directory and writes into it', () => {
  const script = resolveScript('test:coverage');
  assert.match(
    script,
    new RegExp(`${ensureCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} coverage`),
    'coverage directory setup command must precede test execution',
  );
  assert.ok(
    script.includes('--test-coverage-dir=coverage'),
    `test:coverage script must pass "--test-coverage-dir=coverage" (received ${script})`,
  );
});

test('test:junit script prepares reports directory before writing junit report', () => {
  const script = resolveScript('test:junit');
  assert.match(
    script,
    new RegExp(`${ensureCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} reports`),
    'reports directory setup command must precede junit reporter execution',
  );
  assert.ok(
    script.includes('reports/junit.xml'),
    'junit report should be written to reports/junit.xml',
  );
});

test('run-selected respects tests root when autorun is skipped', async () => {
  const originalValue = process.env.RUN_SELECTED_SKIP_AUTORUN;
  process.env.RUN_SELECTED_SKIP_AUTORUN = '1';

  const moduleUrl = new URL('../../scripts/test/run-selected.ts', import.meta.url).href;
  const { collectDefaultTargets, buildNodeArgs } = await import(moduleUrl);

  try {
    const defaultTargets = collectDefaultTargets();

    assert.ok(
      defaultTargets.includes('tests/ci/test-commands.test.ts'),
      'default target discovery should include tests root files',
    );

    const nodeArgs = buildNodeArgs([], [], defaultTargets);
    assert.deepStrictEqual(nodeArgs.slice(0, 3), ['--loader', 'ts-node/esm', '--test']);
    assert.ok(
      nodeArgs.includes('tests/ci/test-commands.test.ts'),
      'default targets should be appended to node arguments when none are provided',
    );
  } finally {
    if (originalValue === undefined) {
      delete process.env.RUN_SELECTED_SKIP_AUTORUN;
    } else {
      process.env.RUN_SELECTED_SKIP_AUTORUN = originalValue;
    }
  }
});

test('run-selected cli filter covers cli test directory', async () => {
  const originalValue = process.env.RUN_SELECTED_SKIP_AUTORUN;
  process.env.RUN_SELECTED_SKIP_AUTORUN = '1';

  const moduleUrl = new URL('../../scripts/test/run-selected.ts', import.meta.url).href;
  const {
    clearFilterCacheForTest,
    getFilterTargetPatternsForTest,
    resolveFilterTargetsForTest,
    setTestFilesForTest,
  } = await import(moduleUrl);

  const simulatedTests = [
    'tests/ci/test-commands.test.ts',
    'tests/cli/run-selected-cli-example.test.ts',
  ];

  try {
    clearFilterCacheForTest();
    setTestFilesForTest(simulatedTests);

    assert.deepStrictEqual(
      getFilterTargetPatternsForTest('cli'),
      ['tests/ci/test-commands.test.ts', 'tests/cli/*.test.ts', 'tests/cli/**/*.test.ts'],
      'cli filter should be configured with ci and cli directories',
    );

    const matches = resolveFilterTargetsForTest('cli');
    assert.deepStrictEqual(
      matches,
      ['tests/ci/test-commands.test.ts', 'tests/cli/run-selected-cli-example.test.ts'],
      'cli filter should resolve both ci and cli implementation tests',
    );
  } finally {
    setTestFilesForTest(undefined);
    clearFilterCacheForTest();

    if (originalValue === undefined) {
      delete process.env.RUN_SELECTED_SKIP_AUTORUN;
    } else {
      process.env.RUN_SELECTED_SKIP_AUTORUN = originalValue;
    }
  }
});

test('run-selected strips unsupported coverage flag', async () => {
  const originalValue = process.env.RUN_SELECTED_SKIP_AUTORUN;
  process.env.RUN_SELECTED_SKIP_AUTORUN = '1';

  const moduleUrl = new URL('../../scripts/test/run-selected.ts', import.meta.url).href;
  const { sanitizeArgs } = await import(moduleUrl);

  try {
    assert.deepStrictEqual(
      sanitizeArgs(['--test-coverage', '--foo'], '20.19.4'),
      ['--foo'],
    );
    assert.deepStrictEqual(sanitizeArgs(['--test-coverage'], '22.0.0'), ['--test-coverage']);
  } finally {
    if (originalValue === undefined) {
      delete process.env.RUN_SELECTED_SKIP_AUTORUN;
    } else {
      process.env.RUN_SELECTED_SKIP_AUTORUN = originalValue;
    }
  }
});
