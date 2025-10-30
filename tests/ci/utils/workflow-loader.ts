import { createRequire, type NodeRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type JsYamlModule = { load: (input: string) => unknown };
export type WorkflowYaml = { jobs?: Record<string, unknown> } & Record<string, unknown>;

type NodeError = Error & { code?: string };

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '..', '..', '..');
const workflowPath = resolve(repoRoot, '.github', 'workflows', 'ci.yml');
const require = createRequire(import.meta.url);

let jsYamlCache: JsYamlModule | undefined;
let jsYamlCacheKey: string | undefined;
let jsYamlRequire: NodeRequire | undefined;
let workflowCache: Promise<WorkflowYaml> | undefined;

export async function importJsYaml(): Promise<JsYamlModule> {
  if (jsYamlCache) return jsYamlCache;
  const { module, cacheKey, loader } = await resolveJsYaml();
  jsYamlCache = module;
  jsYamlCacheKey = cacheKey;
  jsYamlRequire = loader;
  return module;
}

export async function loadWorkflow(): Promise<WorkflowYaml> {
  if (!workflowCache) {
    workflowCache = (async () => {
      const { load } = await importJsYaml();
      const source = await readFile(workflowPath, 'utf8');
      const parsed = load(source);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('workflow must parse to an object');
      }
      return parsed as WorkflowYaml;
    })();
  }
  return workflowCache;
}

export function clearModuleCache(): void {
  if (jsYamlRequire && jsYamlCacheKey) {
    delete jsYamlRequire.cache[jsYamlCacheKey];
  }
  jsYamlCache = undefined;
  jsYamlCacheKey = undefined;
  jsYamlRequire = undefined;
  workflowCache = undefined;
}

export function getWorkflowPath(): string {
  return workflowPath;
}

async function resolveJsYaml(): Promise<{ module: JsYamlModule; cacheKey: string; loader: NodeRequire }> {
  try {
    const direct = require('js-yaml') as JsYamlModule;
    const cacheKey = require.resolve('js-yaml');
    return { module: direct, cacheKey, loader: require };
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  const pnpmDir = resolve(repoRoot, 'node_modules', '.pnpm');
  const entries = await readdir(pnpmDir, { withFileTypes: true });
  const match = entries.find((entry) => entry.isDirectory() && entry.name.startsWith('js-yaml@'));
  if (!match) throw new Error('js-yaml must be present in pnpm store');
  const moduleDir = resolve(pnpmDir, match.name, 'node_modules', 'js-yaml');
  const moduleRequire = createRequire(resolve(moduleDir, 'index.js'));
  const module = moduleRequire('.') as JsYamlModule;
  const cacheKey = moduleRequire.resolve('.');
  return { module, cacheKey, loader: moduleRequire };
}

function isNodeError(error: unknown): error is NodeError {
  return error instanceof Error && 'code' in error;
}
