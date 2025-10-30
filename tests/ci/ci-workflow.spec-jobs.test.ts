/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';
type WorkflowConfig = { jobs?: Record<string, JobConfig> }; type JobConfig = { needs?: string | string[] | undefined }; type JsYamlModule = { load: (source: string) => unknown };
const cwd = dirname(fileURLToPath(import.meta.url)),
  repoRoot = resolve(cwd, '..', '..'),
  workflowPath = resolve(repoRoot, '.github', 'workflows', 'ci.yml'),
  specPath = resolve(repoRoot, 'docs', 'CI-SPEC.md');
const { load } = await importJsYaml();
const readSpecJobOrder = async (): Promise<string[]> => {
  const section = extractSection(await readFile(specPath, 'utf8'), '## 2. 必須ジョブ');
  if (!section) {
    assert.fail('CI-SPEC must include "## 2. 必須ジョブ" section');
  }
  return Array.from(section.matchAll(/\*\*(?<job>[A-Za-z0-9_-]+)\*\*/gu))
    .map((match) => match.groups?.job?.trim())
    .filter((job): job is string => Boolean(job) && job.length > 0);
};
const extractSection = (document: string, heading: string): string | null => {
  const start = document.indexOf(heading);
  if (start === -1) {
    return null;
  }
  const rest = document.slice(start + heading.length);
  const end = rest.search(/\n##\s+/u);
  return end === -1 ? rest : rest.slice(0, end);
};
const ensureDocJobsExist = (order: readonly string[], jobs: Record<string, JobConfig>): void => {
  const missing = order.filter((job) => !Object.hasOwn(jobs, job));
  if (missing.length === 0) {
    return;
  }
  assert.fail([
    'CI-SPEC job list must match workflow jobs',
    'missing in workflow:',
    ...missing.map((job) => `  - ${job}`),
    'available jobs:',
    ...Object.keys(jobs).sort().map((job) => `  - ${job}`),
  ].join('\n'));
};
const normalizeNeeds = (value: JobConfig['needs']): readonly string[] => {
  if (value === undefined) {
    return [];
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? [] : [trimmed];
  }
  if (Array.isArray(value)) {
    return value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter((entry) => entry.length > 0);
  }
  assert.fail('job needs must be configured as string or array of strings');
};
const collectDependencies = (job: string, graph: Map<string, readonly string[]>): string[] => {
  const seen = new Set<string>();
  const queue: string[] = [...(graph.get(job) ?? [])];
  for (let index = 0; index < queue.length; index += 1) {
    const candidate = queue[index];
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    const next = graph.get(candidate);
    if (next) {
      queue.push(...next.filter((entry) => !seen.has(entry)));
    }
  }
  return [...seen];
};
const readWorkflowYaml = async (): Promise<WorkflowConfig> => {
  const parsed = load(await readFile(workflowPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object') {
    assert.fail('workflow must parse to an object');
  }
  return parsed as WorkflowConfig;
};
async function importJsYaml(): Promise<JsYamlModule> {
  const runtimeRequire = createRequire(import.meta.url);
  try {
    return runtimeRequire('js-yaml') as JsYamlModule;
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
  }
  const entries = await readdir(resolve(repoRoot, 'node_modules', '.pnpm'), { withFileTypes: true }),
    match = entries.find((entry) => entry.isDirectory() && entry.name.startsWith('js-yaml@'));
  if (!match) {
    assert.fail('js-yaml must be present in pnpm store');
  }
  const moduleRequire = createRequire(resolve(repoRoot, 'node_modules', '.pnpm', match.name, 'node_modules', 'js-yaml', 'index.js'));
  return moduleRequire('.') as JsYamlModule;
}
function isNodeError(error: unknown): error is Error & { code?: string } { return error instanceof Error && 'code' in error; }
describe('CI spec required jobs', () => {
  test('workflow dependencies must respect documented order', async () => {
    const order = await readSpecJobOrder(); assert(order.length > 0, 'CI-SPEC must enumerate required jobs');
    const workflow = await readWorkflowYaml();
    const jobs = workflow.jobs;
    if (!jobs || typeof jobs !== 'object') {
      assert.fail('workflow must define jobs object');
    }
    ensureDocJobsExist(order, jobs);
    const graph = new Map<string, readonly string[]>(Object.entries(jobs).map(([job, config]) => [job, normalizeNeeds(config.needs)])),
      positions = new Map(order.map((job, index) => [job, index] as const));
    for (const job of order) {
      for (const dependency of collectDependencies(job, graph)) {
        const dependencyIndex = positions.get(dependency);
        if (dependencyIndex === undefined) {
          continue;
        }
        const jobIndex = positions.get(job);
        assert.notStrictEqual(jobIndex, undefined, `missing documented order for job "${job}"`);
        assert.ok(
          dependencyIndex < jobIndex!,
          [
            'CI-SPEC job order must list upstream dependencies first',
            `job: ${job}`,
            `dependency: ${dependency}`,
            `documented order: ${order.map((entry, index) => `${index + 1}. ${entry}`).join(' > ')}`,
          ].join('\n'),
        );
      }
    }
  });
});
