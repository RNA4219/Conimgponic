import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
  scripts?: Record<string, string>;
};

const ensureCommand =
  "node --input-type=module --eval \"import { mkdirSync } from 'node:fs'; const dir = process.argv.at(-1); if (!dir) throw new Error('missing dir'); mkdirSync(dir, { recursive: true });\"";

const resolveScript = (name: string): string => {
  assert.ok(packageJson.scripts, 'package.json.scripts is missing');
  const script = packageJson.scripts[name];
  assert.ok(script, `script ${name} is missing`);
  return script;
};

test('test:coverage script prepares coverage directory and writes into it', () => {
  const script = resolveScript('test:coverage');
  assert.match(
    script,
    new RegExp(`${ensureCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} coverage`),
    'coverage directory setup command must precede test execution',
  );
  assert.ok(
    script.includes('--test-coverage-dir=coverage'),
    'test coverage output should be written to coverage/',
  );
});

test('test:junit script prepares reports directory before writing junit report', () => {
  const script = resolveScript('test:junit');
  assert.match(
    script,
    new RegExp(`${ensureCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} reports`),
    'reports directory setup command must precede junit reporter execution',
  );
  assert.ok(
    script.includes('reports/junit.xml'),
    'junit report should be written to reports/junit.xml',
  );
});
