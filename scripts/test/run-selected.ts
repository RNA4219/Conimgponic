/// <reference types="node" />
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_TEST_ROOT = 'tests';
const DEFAULT_TEST_SUFFIXES = ['.test.ts', '.test.tsx'] as const;
const DEFAULT_TEST_GLOBS = ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] as const;
const TEST_COVERAGE_FLAG = '--test-coverage';
const TEST_COVERAGE_MINIMUM_MAJOR_VERSION = 22;
const FILTER_TARGETS: Record<string, readonly string[]> = {
  autosave: [
    'tests/app/autosave.*.test.ts',
    'tests/app/autosave.*.test.tsx',
    'tests/lib/autosave/*.test.ts',
    'tests/lib/autosave/*.test.tsx',
    'tests/lib/autosave.*.test.ts',
    'tests/lib/autosave.*.test.tsx',
    'tests/lib/autosave.phase-guard.test.ts',
    'tests/lib/autosave.phase-guard.test.tsx',
    'tests/views/*autosave*.test.ts',
    'tests/views/*autosave*.test.tsx',
    'tests/webview/autosave.*.test.ts',
    'tests/webview/autosave.*.test.tsx',
  ],
  merge: [
    'tests/merge/*.test.ts',
    'tests/merge/*.test.tsx',
    'tests/webview/merge.*.test.ts',
    'tests/webview/merge.*.test.tsx',
    'tests/extensions/vscode/merge-bridge.sanitize.test.ts',
    'tests/extensions/vscode/merge-bridge.sanitize.test.tsx',
    'tests/components/*.test.ts',
    'tests/components/*.test.tsx',
  ],
  golden: ['tests/export/golden*.test.ts'],
  collector: [
    'tests/plugins/*.test.ts',
    'tests/plugins/*.test.tsx',
    'tests/plugins/**/*.test.ts',
    'tests/plugins/**/*.test.tsx',
    'tests/plugins/*collector*.test.ts',
    'tests/plugins/**/*collector*.test.ts',
    'tests/plugins/*reload*.test.ts',
    'tests/plugins/**/*reload*.test.ts',
    'tests/platform/vscode/plugins.*.test.ts',
    'tests/platform/vscode/plugins.*.test.tsx',
    'tests/platform/vscode/*collector*.test.ts',
    'tests/platform/vscode/**/*collector*.test.ts',
    'tests/platform/vscode/*reload*.test.ts',
    'tests/platform/vscode/**/*reload*.test.ts',
  ],
  ci: ['tests/ci/ci-*.test.ts', 'tests/ci/security-*.test.ts'],
  cli: ['tests/ci/test-commands.test.ts', 'tests/cli/*.test.ts', 'tests/cli/**/*.test.ts'],
  telemetry: ['tests/telemetry/*.test.ts'],
};

let cachedTestFiles: readonly string[] | undefined;

export function clearFilterCacheForTest(): void {
  cachedTestFiles = undefined;
}

export function setTestFilesForTest(files: readonly string[] | undefined): void {
  cachedTestFiles = files === undefined ? undefined : [...files];
}

export function resolveFilterTargetsForTest(suite: string): readonly string[] | undefined {
  const patterns = FILTER_TARGETS[suite];

  if (patterns === undefined) {
    return undefined;
  }

  return matchFilterTargets(patterns);
}

export function getFilterTargetPatternsForTest(suite: string): readonly string[] | undefined {
  return FILTER_TARGETS[suite];
}

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
    (includesFilterToken(args) ? [...DEFAULT_TEST_GLOBS] : determineDefaultTargets());
  const nodeArgs = buildNodeArgs(filteredArgs, explicitTargets, resolvedDefaultTargets);

  const childEnv = buildSpawnEnv(process.env);
  const child = spawnImpl('node', nodeArgs, { stdio: 'inherit', env: childEnv });

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

export function collectDefaultTargets(): readonly string[] {
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

      if (entry.isFile() && hasDefaultTestSuffix(entry.name)) {
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
  const baseArgs = [
    '--experimental-vm-modules',
    '--loader',
    'ts-node/esm',
    '--experimental-specifier-resolution=node',
    '--test',
  ];
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

  return [...DEFAULT_TEST_GLOBS];
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
  if (patterns.length === 0) {
    return [];
  }

  const tests = listAllTests().map((file) => file.replace(/\\/g, '/'));
  const matchers = patterns.map(toPatternRegExp);
  const matches = new Set<string>();

  for (const testPath of tests) {
    if (matchers.some((regex) => regex.test(testPath))) {
      matches.add(testPath);
    }
  }

  return [...matches].sort();
}

function listAllTests(): readonly string[] {
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

      if (entry.isFile() && hasDefaultTestSuffix(entry.name)) {
        result.push(entryPath);
      }
    }
  }

  cachedTestFiles = [...result];
  return cachedTestFiles;
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

function hasDefaultTestSuffix(fileName: string): boolean {
  return DEFAULT_TEST_SUFFIXES.some((suffix) => fileName.endsWith(suffix));
}

function buildSpawnEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const requiredCompilerOptions: Record<string, unknown> = {
    moduleResolution: 'bundler',
    types: ['node'],
    allowSyntheticDefaultImports: true,
  };

  const existing = env.TS_NODE_COMPILER_OPTIONS;

  if (existing) {
    const merged = mergeCompilerOptions(existing, requiredCompilerOptions);
    env.TS_NODE_COMPILER_OPTIONS = merged;
    if (!env.TS_NODE_PROJECT) {
      env.TS_NODE_PROJECT = 'tests/tsconfig.json';
    }
    if (!env.TS_NODE_TRANSPILE_ONLY) {
      env.TS_NODE_TRANSPILE_ONLY = '1';
    }
    return env;
  }

  env.TS_NODE_COMPILER_OPTIONS = JSON.stringify(requiredCompilerOptions);
  if (!env.TS_NODE_PROJECT) {
    env.TS_NODE_PROJECT = 'tests/tsconfig.json';
  }
  if (!env.TS_NODE_TRANSPILE_ONLY) {
    env.TS_NODE_TRANSPILE_ONLY = '1';
  }
  return env;
}

function mergeCompilerOptions(
  serialized: string,
  required: Record<string, unknown>,
): string {
  try {
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    const types = mergeTypes(parsed.types, required.types);

    return JSON.stringify({
      ...required,
      ...parsed,
      moduleResolution: parsed.moduleResolution ?? required.moduleResolution,
      types,
    });
  } catch {
    return JSON.stringify(required);
  }
}

function mergeTypes(
  existing: unknown,
  required: unknown,
): ReadonlyArray<string> {
  const next = new Set<string>();

  if (Array.isArray(required)) {
    for (const value of required) {
      if (typeof value === 'string') {
        next.add(value);
      }
    }
  }

  if (Array.isArray(existing)) {
    for (const value of existing) {
      if (typeof value === 'string') {
        next.add(value);
      }
    }
  }

  if (next.size === 0) {
    return ['node'];
  }

  return [...next];
}
