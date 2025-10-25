import { spawn } from 'node:child_process';
import { mkdir, opendir } from 'node:fs/promises';
import { join } from 'node:path';

await mkdir('coverage', { recursive: true });
await mkdir('reports', { recursive: true });

async function collectTestFiles(rootDir) {
  const collected = [];

  const visit = async (directory) => {
    let dir;
    try {
      dir = await opendir(directory);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw new Error(`Test directory not found: ${directory}`);
      }
      throw error;
    }

    for await (const dirent of dir) {
      const entryPath = join(directory, dirent.name);
      if (dirent.isDirectory()) {
        await visit(entryPath);
      } else if (dirent.isFile() && dirent.name.endsWith('.test.ts')) {
        collected.push(entryPath);
      }
    }
  };

  await visit(rootDir);
  return collected;
}

const testFiles = await collectTestFiles('tests');

if (testFiles.length === 0) {
  console.error("No test files matched pattern 'tests/**/*.test.ts'.");
  process.exit(1);
}

const args = [
  '--loader',
  'ts-node/esm',
  '--test',
  '--test-reporter=junit',
  '--test-reporter-destination=file=reports/junit.xml',
  ...testFiles,
];

const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env: { ...process.env, NODE_V8_COVERAGE: 'coverage' },
});

let exitCode;

try {
  exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);

    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        resolve(null);
        return;
      }

      resolve(code ?? 1);
    });
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}

if (exitCode === null) {
  process.exit(0);
}

if (exitCode !== 0) {
  process.exit(exitCode);
}
