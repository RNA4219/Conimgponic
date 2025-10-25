/// <reference types="node" />
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_TEST_GLOB = 'tests/**/*.test.ts';
const DEFAULT_TEST_SUFFIX = '.test.ts';
const DEFAULT_TEST_ROOT = DEFAULT_TEST_GLOB.includes('/**')
  ? DEFAULT_TEST_GLOB.slice(0, DEFAULT_TEST_GLOB.indexOf('/**'))
  : DEFAULT_TEST_GLOB;

export function run(argv: readonly string[] = process.argv.slice(2)): void {
  const explicitTargets = collectExplicitTargets(argv);
  const defaultTargets = explicitTargets.length > 0 ? [] : collectDefaultTargets();

  if (explicitTargets.length === 0 && defaultTargets.length === 0) {
    console.error(`No test files matched pattern "${DEFAULT_TEST_GLOB}".`);
    process.exit(1);
  }

  const nodeArgs = buildNodeArgs(argv, explicitTargets, defaultTargets);

  const child = spawn('node', nodeArgs, { stdio: 'inherit', env: process.env });

  child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code === null ? 1 : code);
  });

  child.on('error', (error: Error) => {
    console.error(error);
    process.exit(1);
  });
}

if (
  process.env.RUN_SELECTED_SKIP_AUTORUN !== '1' &&
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href
) {
  run();
}

export function collectExplicitTargets(args: readonly string[]): string[] {
  const targets: string[] = [];
  const targetPattern = /[\\\/*\.]/;
  let inExplicitSection = false;

  for (const arg of args) {
    if (inExplicitSection) {
      targets.push(arg);
      continue;
    }

    if (arg === '--') {
      inExplicitSection = true;
      continue;
    }

    if (!arg.startsWith('-') && targetPattern.test(arg)) {
      targets.push(arg);
    }
  }

  return targets;
}

export function collectDefaultTargets(): string[] {
  if (!DEFAULT_TEST_ROOT || !existsSync(DEFAULT_TEST_ROOT)) {
    return [];
  }

  const results: string[] = [];
  const stack: string[] = [DEFAULT_TEST_ROOT];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(DEFAULT_TEST_SUFFIX)) {
        results.push(fullPath);
      }
    }
  }

  results.sort();
  return results;
}

export function buildNodeArgs(
  args: readonly string[],
  targets: readonly string[],
  defaultTargets: readonly string[],
): string[] {
  const baseArgs = ['--loader', 'ts-node/esm', '--test'];

  if (targets.length > 0) {
    return [...baseArgs, ...args];
  }

  return [...baseArgs, ...args, ...defaultTargets];
}
