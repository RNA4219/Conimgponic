/// <reference types="node" />
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const DEFAULT_TEST_ROOT = 'tests';
const DEFAULT_TEST_SUFFIXES = ['.test.ts', '.test.tsx', '.test.mjs'] as const;
const DEFAULT_TEST_GLOBS = [
  'tests/**/*.test.ts',
  'tests/**/*.test.tsx',
  'tests/**/*.test.mjs',
] as const;
const moduleLoader = createRequire(import.meta.url);

type LoaderResolution = {
  flag: '--import' | '--loader';
  module: string;
};

const NODE_TEST_LOADER = resolveNodeTestLoader();

const NODE_TEST_BASE_ARGS: readonly string[] = [
  '--experimental-vm-modules',
  NODE_TEST_LOADER.flag,
  NODE_TEST_LOADER.module,
  '--experimental-specifier-resolution=node',
  '--test',
  '--test-timeout=30000',
];

function resolveNodeTestLoader(): LoaderResolution {
  const candidates: readonly LoaderResolution[] = [
    { flag: '--import', module: 'tsx/esm' },
    { flag: '--loader', module: 'ts-node/esm' },
  ];

  for (const candidate of candidates) {
    try {
      moduleLoader.resolve(candidate.module);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'MODULE_NOT_FOUND') {
        throw error;
      }
    }
  }

  return { flag: '--loader', module: 'ts-node/esm' };
}
const TEST_COVERAGE_FLAG = '--test-coverage';
const TEST_COVERAGE_MINIMUM_MAJOR_VERSION = 22;
const FILTER_TARGETS: Record<string, readonly string[]> = {
  app: [
    'tests/app/app.*.test.ts',
    'tests/app/app.*.test.tsx',
    'tests/app/autosave.*.test.ts',
    'tests/app/autosave.*.test.tsx'
  ],
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
    'tests/merge/*.test.mjs',
    'tests/webview/merge.*.test.ts',
    'tests/webview/merge.*.test.tsx',
    'tests/webview/merge.*.test.mjs',
    'tests/extensions/vscode/merge-bridge.sanitize.test.ts',
    'tests/extensions/vscode/merge-bridge.sanitize.test.tsx',
    'tests/extensions/vscode/merge-bridge.sanitize.test.mjs',
    'tests/components/*.test.ts',
    'tests/components/*.test.tsx',
    'tests/components/*.test.mjs',
  ],
  components: [
    'tests/components/*.test.ts',
    'tests/components/*.test.tsx',
    'tests/components/*.test.mjs',
  ],
  'merge.diff': ['tests/components/merge.diff.test.tsx'],
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
  'diff-merge-view-state': ['tests/components/DiffMergeView.test.tsx'],
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
  const forwardedArgs = filteredArgs.filter((arg) => arg !== '--update-snapshots');
  const updateSnapshots = forwardedArgs.length !== filteredArgs.length;
  const explicitTargets = collectExplicitTargets(forwardedArgs);
  const resolvedDefaultTargets =
    defaultTargets ??
    filterResult?.targets ??
    (includesFilterToken(forwardedArgs) ? [...DEFAULT_TEST_GLOBS] : determineDefaultTargets());
  const nodeArgs = buildNodeArgs(forwardedArgs, explicitTargets, resolvedDefaultTargets);

  const childEnv = buildSpawnEnv(process.env);
  if (updateSnapshots) {
    childEnv.UPDATE_SNAPSHOTS = '1';
  }
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

export function getNodeTestBaseArgsForTest(): readonly string[] {
  return NODE_TEST_BASE_ARGS;
}

export function collectExplicitTargets(args: readonly string[]): string[] {
  const targets: string[] = [];
  const targetPattern = /[\\\/*\.]/;
  let inExplicitSection = false;

  for (const arg of args) {
    if (inExplicitSection) {
      if (!arg.startsWith('-') || targetPattern.test(arg)) {
        targets.push(arg);
      }
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
  const baseArgs = [...NODE_TEST_BASE_ARGS];
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
  const coverageSupported = supportsTestCoverage(nodeVersion);
  const sanitized: string[] = [];

  for (const arg of args) {
    if (arg === '--filter') {
      continue;
    }

    if (arg === '--reporter') {
      sanitized.push('--test-reporter');
      continue;
    }

    if (arg.startsWith('--reporter=')) {
      sanitized.push(`--test-reporter${arg.slice('--reporter'.length)}`);
      continue;
    }

    if (arg === '--reporter-destination') {
      sanitized.push('--test-reporter-destination');
      continue;
    }

    if (arg.startsWith('--reporter-destination=')) {
      sanitized.push(`--test-reporter-destination${arg.slice('--reporter-destination'.length)}`);
      continue;
    }

    if (arg === TEST_COVERAGE_FLAG && !coverageSupported) {
      continue;
    }

    sanitized.push(arg);
  }

  return sanitized;
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
  const compilerOptions = mergeCompilerOptions(env.TS_NODE_COMPILER_OPTIONS);
  env.TS_NODE_COMPILER_OPTIONS = JSON.stringify(compilerOptions);
  return env;
}

type CompilerOptions = Record<string, unknown> & {
  types?: readonly string[];
};

function mergeCompilerOptions(raw: string | undefined): CompilerOptions {
  const parsed = parseCompilerOptions(raw);
  const types = normalizeTypes(parsed.types);

  return {
    ...parsed,
    moduleResolution: 'bundler',
    allowSyntheticDefaultImports: true,
    types,
  };
}

function parseCompilerOptions(raw: string | undefined): CompilerOptions {
  if (raw === undefined || raw.trim() === '') {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as CompilerOptions;
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (error) {
    console.warn('Failed to parse TS_NODE_COMPILER_OPTIONS, falling back to defaults.', error);
  }

  return {};
}

function normalizeTypes(value: CompilerOptions['types']): readonly string[] {
  if (!Array.isArray(value)) {
    return ['node'];
  }

  const deduplicated = new Set<string>();

  for (const entry of value) {
    if (typeof entry === 'string' && entry.length > 0) {
      deduplicated.add(entry);
    }
  }

  deduplicated.add('node');

  return [...deduplicated];
}
