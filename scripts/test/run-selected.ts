import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const DEFAULT_TEST_GLOB = 'tests/**/*.test.ts';
const argv = process.argv.slice(2);

try {
  main();
} catch (error) {
  console.error('Failed to launch test runner:', error);
  process.exit(1);
}

function main(): void {
  const { replacedArgs, hasExplicitTargets } = replaceExplicitTargets(argv);
  const nodeArgs = buildNodeArgs(replacedArgs, hasExplicitTargets);

  const child = spawn('node', nodeArgs, { stdio: 'inherit', env: process.env });

  child.on('exit', (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code === null ? 1 : code);
  });

  child.on('error', (error) => {
    console.error(error);
    process.exit(1);
  });
}

function buildNodeArgs(args: string[], hasExplicitTargets: boolean): string[] {
  const baseArgs = ['--loader', 'ts-node/esm', '--test'];

  if (hasExplicitTargets) {
    return [...baseArgs, ...args];
  }

  return [...baseArgs, ...args, DEFAULT_TEST_GLOB];
}

function replaceExplicitTargets(args: string[]): { replacedArgs: string[]; hasExplicitTargets: boolean } {
  const targetPattern = /[\\\/*\.]/;
  const replacedArgs: string[] = [];
  let hasExplicitTargets = false;
  let inExplicitSection = false;

  for (const arg of args) {
    if (arg === '--' && !inExplicitSection) {
      inExplicitSection = true;
      replacedArgs.push(arg);
      continue;
    }

    const shouldExpand =
      (inExplicitSection && !arg.startsWith('-')) ||
      (!inExplicitSection && !arg.startsWith('-') && targetPattern.test(arg));

    if (shouldExpand) {
      hasExplicitTargets = true;
      const expanded = expandTarget(arg);
      if (expanded.length === 0) {
        replacedArgs.push(arg);
        continue;
      }
      replacedArgs.push(...expanded);
      continue;
    }

    replacedArgs.push(arg);
  }

  return { replacedArgs, hasExplicitTargets };
}

function expandTarget(target: string): string[] {
  if (!/[*?]/.test(target)) {
    return [target];
  }

  if (target.includes('**/')) {
    return expandDeepWildcard(target);
  }

  return matchShallowPattern(target);
}

function matchShallowPattern(pattern: string): string[] {
  const directory = dirname(pattern);
  const filePattern = basename(pattern);
  const searchRoot = directory === '.' ? '.' : directory;
  const absoluteRoot = resolve(searchRoot);

  if (!existsSync(absoluteRoot)) {
    return [];
  }

  const matcher = createMatcher(filePattern);
  const entries = readdirSync(absoluteRoot, { withFileTypes: true });

  const matches: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (matcher.test(entry.name)) {
      matches.push(searchRoot === '.' ? entry.name : `${searchRoot}/${entry.name}`);
    }
  }

  return matches;
}

function expandDeepWildcard(pattern: string): string[] {
  const [basePart, remainder] = pattern.split('**/', 2);
  const baseDir = basePart.endsWith('/') ? basePart.slice(0, -1) : basePart;
  const searchRoot = baseDir === '' ? '.' : baseDir;
  const absoluteRoot = resolve(searchRoot);

  if (!existsSync(absoluteRoot)) {
    return [];
  }

  const matcher = createMatcher(remainder);
  const matches: string[] = [];

  const traverse = (absoluteDir: string, relativeDir: string): void => {
    const entries = readdirSync(absoluteDir, { withFileTypes: true });

    for (const entry of entries) {
      const nextRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const nextAbsolute = join(absoluteDir, entry.name);

      if (entry.isDirectory()) {
        traverse(nextAbsolute, nextRelative);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (matchesDeepRemainder(nextRelative, entry.name, remainder, matcher)) {
        matches.push(searchRoot === '.' ? nextRelative : `${searchRoot}/${nextRelative}`);
      }
    }
  };

  traverse(absoluteRoot, '');

  return matches;
}

function matchesDeepRemainder(relativePath: string, fileName: string, remainder: string, matcher: RegExp): boolean {
  if (remainder.includes('/')) {
    return matcher.test(relativePath);
  }

  return matcher.test(fileName);
}

function createMatcher(pattern: string): RegExp {
  const escaped = pattern.replace(/([.+^${}()|[\]\\])/g, '\\$1');
  const source = escaped.replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${source}$`);
}
