/// <reference types="node" />

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';

import { runSelected } from './run-selected.js';

type SpawnFn = typeof import('node:child_process')['spawn'];

test('maps --filter autosave to autosave test glob', async () => {
  const nodeArgs = await collectNodeArgs(['--filter', 'autosave']);

  assert.deepStrictEqual(nodeArgs, [
    '--loader',
    'ts-node/esm',
    '--test',
    'tests/app/autosave.integration.test.ts',
    'tests/app/autosave.plan.test.ts',
    'tests/lib/autosave.dispose.test.ts',
    'tests/lib/autosave.phase-guard.test.ts',
    'tests/lib/autosave/init.test.ts',
    'tests/lib/autosave/scheduler.test.ts',
    'tests/views/view-switch.autosave.test.ts',
    'tests/webview/autosave.bridge.test.ts',
    'tests/webview/autosave.vscode.test.ts',
  ]);
});

test('falls back to default glob when filter is unknown', async () => {
  const nodeArgs = await collectNodeArgs(['--filter', 'collector']);

  assert.deepStrictEqual(nodeArgs, [
    '--loader',
    'ts-node/esm',
    '--test',
    '--filter',
    'collector',
    'tests/**/*.test.ts',
  ]);
});

async function collectNodeArgs(argvTail: readonly string[]): Promise<readonly string[]> {
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

  process.argv = [...originalArgv.slice(0, 2), ...argvTail];

  try {
    runSelected(undefined, spawnStub);
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
