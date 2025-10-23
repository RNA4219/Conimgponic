import { spawn } from 'node:child_process';

const DEFAULT_TEST_GLOB = 'tests/**/*.test.ts';
const argv = process.argv.slice(2);

const explicitTargets = collectExplicitTargets(argv);
const nodeArgs = buildNodeArgs(argv, explicitTargets);

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

function collectExplicitTargets(args: string[]): string[] {
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

function buildNodeArgs(args: string[], targets: string[]): string[] {
  const baseArgs = ['--loader', 'ts-node/esm', '--test'];

  if (targets.length > 0) {
    return [...baseArgs, ...args];
  }

  return [...baseArgs, ...args, DEFAULT_TEST_GLOB];
}
