/// <reference types="node" />

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

type SpawnFn = typeof import('node:child_process')['spawn'];
type RunSelectedModule = typeof import('./run-selected.js');

const moduleTsUrl = new URL('./run-selected.ts', import.meta.url);
const moduleJsUrl = new URL('./run-selected.js', import.meta.url);

test('runSelected resolves autosave filter in autorun scenario', async () => {
  const module = await importRunSelectedModule();
  const originalArgv = process.argv;

  const spawnCalls: Array<Parameters<SpawnFn>> = [];
  const fakeChild: Partial<ChildProcess> = {
    on(event, handler) {
      if (event === 'exit') {
        queueMicrotask(() => {
          (handler as (code: number | null, signal: NodeJS.Signals | null) => void)(0, null);
        });
      }
      return this as ChildProcess;
    },
  };

  const spawnStub: SpawnFn = ((...args: Parameters<SpawnFn>) => {
    spawnCalls.push(args);
    return fakeChild as ChildProcess;
  }) as SpawnFn;

  const exitMock = mock.method(process, 'exit', () => undefined as never);

  process.argv = [originalArgv[0] ?? 'node', fileURLToPath(moduleTsUrl), '--filter', 'autosave'];

  try {
    module.runSelected(undefined, spawnStub);
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    process.argv = originalArgv;
    exitMock.mock.restore();
  }

  assert.strictEqual(spawnCalls.length, 1);
  const [command, nodeArgs] = spawnCalls[0];
  assert.strictEqual(command, 'node');
  assert.deepStrictEqual(nodeArgs, [
    '--loader',
    'ts-node/esm',
    '--test',
    'tests/app/autosave.integration.test.ts',
    'tests/app/autosave.plan.test.ts',
    'tests/lib/autosave.dispose.test.ts',
    'tests/lib/autosave.phase-guard.test.ts',
    'tests/lib/autosave/history.flow.test.ts',
    'tests/lib/autosave/init.test.ts',
    'tests/lib/autosave/restore.flow.test.ts',
    'tests/lib/autosave/scheduler.test.ts',
    'tests/views/view-switch.autosave.test.ts',
    'tests/webview/autosave.bridge.test.ts',
    'tests/webview/autosave.vscode.test.ts',
  ]);
});

test('maps --filter autosave to autosave test glob', async () => {
  const module = await importRunSelectedModule();
  const nodeArgs = await collectNodeArgs(module, ['--filter', 'autosave']);

  assert.deepStrictEqual(nodeArgs, [
    '--loader',
    'ts-node/esm',
    '--test',
    'tests/app/autosave.integration.test.ts',
    'tests/app/autosave.plan.test.ts',
    'tests/lib/autosave.dispose.test.ts',
    'tests/lib/autosave.phase-guard.test.ts',
    'tests/lib/autosave/history.flow.test.ts',
    'tests/lib/autosave/init.test.ts',
    'tests/lib/autosave/restore.flow.test.ts',
    'tests/lib/autosave/scheduler.test.ts',
    'tests/views/view-switch.autosave.test.ts',
    'tests/webview/autosave.bridge.test.ts',
    'tests/webview/autosave.vscode.test.ts',
  ]);
});

test('maps --filter golden to golden comparison tests', async () => {
  const module = await importRunSelectedModule();
  const nodeArgs = await collectNodeArgs(module, ['--filter', 'golden']);

  assert.deepStrictEqual(nodeArgs, [
    '--loader',
    'ts-node/esm',
    '--test',
    'tests/export/golden.webview.test.ts',
  ]);
});

test('includes tsx component tests when filtering merge suite', async () => {
  const nodeArgs = await collectNodeArgs(['--filter', 'merge']);

  assert.ok(
    nodeArgs.includes('tests/components/DiffMergeView.test.tsx'),
    'expected merge filter to include DiffMergeView tsx test',
  );
});

test('includes tsx component tests in default discovery', async () => {
  const nodeArgs = await collectNodeArgs([]);

  assert.ok(
    nodeArgs.includes('tests/components/DiffMergeView.test.tsx'),
    'expected default discovery to include DiffMergeView tsx test',
  );
});

test('falls back to default glob when filter is unknown', async () => {
  const module = await importRunSelectedModule();
  const nodeArgs = await collectNodeArgs(module, ['--filter', 'collector']);

  assert.deepStrictEqual(nodeArgs, [
    '--loader',
    'ts-node/esm',
    '--test',
    '--filter',
    'collector',
    'tests/**/*.test.ts',
    'tests/**/*.test.tsx',
  ]);
});

test('falls back to default glob when filter is unknown', async () => {
  const module = await importRunSelectedModule();
  const nodeArgs = await collectNodeArgs(module, ['--filter', 'missing']);

  assert.deepStrictEqual(nodeArgs, [
    '--loader',
    'ts-node/esm',
    '--test',
    '--filter',
    'missing',
    'tests/**/*.test.ts',
    'tests/**/*.test.tsx',
  ]);
});

async function importRunSelectedModule(): Promise<RunSelectedModule> {
  return import(moduleJsUrl.href);
}

async function collectNodeArgs(argvTail: readonly string[]): Promise<readonly string[]>;
async function collectNodeArgs(
  module: RunSelectedModule,
  argvTail: readonly string[],
): Promise<readonly string[]>;
async function collectNodeArgs(
  moduleOrArgvTail: RunSelectedModule | readonly string[],
  maybeArgvTail?: readonly string[],
): Promise<readonly string[]> {
  const originalArgv = process.argv;
  const spawnCalls: Array<Parameters<SpawnFn>> = [];

  const fakeChild: Partial<ChildProcess> = {
    on(event, handler) {
      if (event === 'exit') {
        queueMicrotask(() => {
          (handler as (code: number | null, signal: NodeJS.Signals | null) => void)(0, null);
        });
      }
      return this as ChildProcess;
    },
  };

  const spawnStub: SpawnFn = ((...args: Parameters<SpawnFn>) => {
    spawnCalls.push(args);
    return fakeChild as ChildProcess;
  }) as SpawnFn;

  const exitMock = mock.method(process, 'exit', () => undefined as never);

  let module: RunSelectedModule;
  let argvTail: readonly string[];

  if (Array.isArray(moduleOrArgvTail)) {
    module = await importRunSelectedModule();
    argvTail = moduleOrArgvTail;
  } else {
    module = moduleOrArgvTail as RunSelectedModule;
    argvTail = maybeArgvTail ?? [];
  }

  process.argv = [...originalArgv.slice(0, 2), ...argvTail];

  try {
    module.runSelected(undefined, spawnStub);
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    process.argv = originalArgv;
    exitMock.mock.restore();
  }

  assert.strictEqual(spawnCalls.length, 1);
  const [, nodeArgs] = spawnCalls[0];
  assert.ok(Array.isArray(nodeArgs));
  return nodeArgs;
}
