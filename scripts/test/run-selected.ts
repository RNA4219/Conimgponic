/// <reference types="node" />
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_TEST_ROOT = 'tests';
const DEFAULT_TEST_SUFFIX = '.test.ts';
const DEFAULT_TEST_GLOB = 'tests/**/*.test.ts';
const TEST_COVERAGE_FLAG = '--test-coverage';
const TEST_COVERAGE_MINIMUM_MAJOR_VERSION = 22;
const FILTER_TARGETS: Record<string, readonly string[]> = {
  autosave: [
    'tests/app/autosave.*.test.ts',
    'tests/lib/autosave/*.test.ts',
    'tests/lib/autosave.*.test.ts',
    'tests/lib/autosave.phase-guard.test.ts',
    'tests/views/*autosave*.test.ts',
    'tests/webview/autosave.*.test.ts',
  ],
  merge: [
    'tests/merge/*.test.ts',
    'tests/webview/merge.*.test.ts',
    'tests/extensions/vscode/merge-bridge.sanitize.test.ts',
  ],
  golden: ['tests/export/golden*.test.ts', 'tests/export/golden/**/*.test.ts'],
  ci: ['tests/ci/ci-*.test.ts', 'tests/ci/security-*.test.ts'],
  cli: ['tests/ci/test-commands.test.ts'],
  telemetry: ['tests/telemetry/*.test.ts'],
};

let cachedTestFiles: string[] | undefined;

export function runSelected(
  args: readonly string[] = process.argv.slice(2),
  spawnImpl: typeof spawn = spawn,
  defaultTargets?: readonly string[],
): void {
  const filterResult = resolveFilter(args);
  const filteredArgs = filterResult?.filteredArgs ?? args;
  const explicitTargets = collectExplicitTargets(filteredArgs);
  const resolvedDefaultTargets =
    defaultTargets ??
    filterResult?.targets ??
    (includesFilterToken(args) ? [DEFAULT_TEST_GLOB] : determineDefaultTargets());
  const nodeArgs = buildNodeArgs(filteredArgs, explicitTargets, resolvedDefaultTargets);

  const child = spawnImpl('node', nodeArgs, { stdio: 'inherit', env: process.env });

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

if (process.env.RUN_SELECTED_SKIP_AUTORUN !== '1' && isMainModule(import.meta.url)) {
  runSelected();
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
  const sanitizedArgs = sanitizeArgs(args);

  if (targets.length > 0) {
    return [...baseArgs, ...sanitizedArgs];
  }

  return [...baseArgs, ...sanitizedArgs, ...defaultTargets];
}

export function sanitizeArgs(
  args: readonly string[],
  nodeVersion: string = process.versions.node,
): string[] {
  if (!args.includes(TEST_COVERAGE_FLAG)) {
    return [...args];
  }

  if (supportsTestCoverage(nodeVersion)) {
    return [...args];
  }

  return args.filter((arg) => arg !== TEST_COVERAGE_FLAG);
}

function determineDefaultTargets(): readonly string[] {
  const discovered = collectDefaultTargets();
  if (discovered.length > 0) {
    return discovered;
  }

  return [DEFAULT_TEST_GLOB];
}

function includesFilterToken(args: readonly string[]): boolean {
  return args.includes('--filter');
}

function resolveFilter(args: readonly string[]): { filteredArgs: string[]; targets: readonly string[] } | undefined {
  const mutableArgs = [...args];

  for (let index = 0; index < mutableArgs.length; index += 1) {
    const token = mutableArgs[index];

    if (token !== '--filter') {
      continue;
    }

    const suite = mutableArgs[index + 1];

    if (typeof suite !== 'string') {
      return undefined;
    }

    const targetPatterns = FILTER_TARGETS[suite];

    if (targetPatterns === undefined) {
      return undefined;
    }

    const matchedTargets = matchFilterTargets(targetPatterns);

    if (matchedTargets.length === 0) {
      return undefined;
    }

    mutableArgs.splice(index, 2);
    return { filteredArgs: mutableArgs, targets: matchedTargets };
  }

  return undefined;
}

function matchFilterTargets(patterns: readonly string[]): string[] {
  const tests = listAllTests();
  const matchers = patterns.map(toPatternRegExp);
  const matches = new Set<string>();

  for (const file of tests) {
    const normalized = file.replace(/\\/g, '/');

    if (matchers.some((regex) => regex.test(normalized))) {
      matches.add(normalized);
    }
  }

  return [...matches].sort();
}

function listAllTests(): string[] {
  if (cachedTestFiles !== undefined) {
    return cachedTestFiles;
  }

  const result: string[] = [];
  const queue: string[] = [DEFAULT_TEST_ROOT];

  while (queue.length > 0) {
    const current = queue.pop();

    if (current === undefined) {
      continue;
    }

    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(current, entry.name);

      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(DEFAULT_TEST_SUFFIX)) {
        result.push(entryPath);
      }
    }
  }

  cachedTestFiles = result;
  return result;
}

function toPatternRegExp(pattern: string): RegExp {
  const placeholder = '__DOUBLE_STAR__';
  const normalized = pattern.replace(/\\/g, '/');
  const withPlaceholder = normalized.replace(/\*\*/g, placeholder);
  const escaped = withPlaceholder.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const singleStarReplaced = escaped.replace(/\*/g, '[^/]*');
  const finalPattern = singleStarReplaced.replace(new RegExp(placeholder, 'g'), '.*');
  return new RegExp(`^${finalPattern}$`);
}

function isMainModule(moduleUrl: string): boolean {
  const entryPath = process.argv[1];

  if (!entryPath) {
    return false;
  }

  const entryUrl = pathToFileURL(resolve(entryPath)).href;
  return entryUrl === moduleUrl;
}

function supportsTestCoverage(nodeVersion: string): boolean {
  const [majorToken] = nodeVersion.split('.', 1);
  const major = Number.parseInt(majorToken, 10);

  if (Number.isNaN(major)) {
    return false;
  }

  return major >= TEST_COVERAGE_MINIMUM_MAJOR_VERSION;
}
