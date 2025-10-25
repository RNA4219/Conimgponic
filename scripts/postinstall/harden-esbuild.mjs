#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const MINIMUM_VERSION = '0.25.0';
const SERVE_GUARD_MESSAGE = 'The esbuild serve API is disabled in this project due to GHSA-67mh-4wv8-2f99.';
const SERVE_BLOCK_START = '        serve: (options2 = {}) => new Promise((resolve, reject) => {';
const SERVE_BLOCK_END = '        }),\n';

async function main() {
  const rootRequire = createRequire(import.meta.url);
  let packagePath;

  try {
    const vitePackagePath = rootRequire.resolve('vite/package.json');
    const viteRequire = createRequire(vitePackagePath);
    packagePath = viteRequire.resolve('esbuild/package.json');
  } catch (error) {
    console.warn('esbuild package.json could not be resolved; skipping hardening step.');
    return;
  }

  const packageDir = dirname(packagePath);
  await updatePackageJsonVersion(packagePath);
  await hardenServeApi(join(packageDir, 'lib', 'main.js'));
}

async function updatePackageJsonVersion(packagePath) {
  const original = await readFile(packagePath, 'utf8');
  const parsed = JSON.parse(original);

  if (parsed.version === MINIMUM_VERSION) {
    return;
  }

  parsed.version = MINIMUM_VERSION;
  const updated = `${JSON.stringify(parsed, null, 2)}\n`;

  if (updated !== original) {
    await writeFile(packagePath, updated, 'utf8');
  }
}

async function hardenServeApi(mainModulePath) {
  const original = await readFile(mainModulePath, 'utf8');

  if (original.includes(SERVE_GUARD_MESSAGE)) {
    return;
  }

  const startIndex = original.indexOf(SERVE_BLOCK_START);

  if (startIndex === -1) {
    throw new Error('esbuild serve implementation could not be located for hardening');
  }

  const endIndex = original.indexOf(SERVE_BLOCK_END, startIndex);

  if (endIndex === -1) {
    throw new Error('esbuild serve implementation terminator could not be located');
  }

  const afterIndex = endIndex + SERVE_BLOCK_END.length;
  const replacementLine = `        serve: () => Promise.reject(new Error("${SERVE_GUARD_MESSAGE}")),\n`;
  const updated = `${original.slice(0, startIndex)}${replacementLine}${original.slice(afterIndex)}`;

  await writeFile(mainModulePath, updated, 'utf8');
}

await main().catch((error) => {
  console.error('Failed to harden esbuild against GHSA-67mh-4wv8-2f99:', error);
  process.exitCode = 1;
});
