import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))

const withExt = (spec: string): string => (spec.endsWith('.ts') || spec.endsWith('.js') ? spec : `${spec}.ts`)

const resolveImport = (spec: string, parent: string): string => {
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const target = resolve(dirname(parent), withExt(spec))
    if (target.endsWith('.js') && !existsSync(target)) {
      const tsFallback = target.replace(/\.js$/, '.ts')
      if (existsSync(tsFallback)) {
        return tsFallback
      }
    }
    return target
  }
  return createRequire(parent).resolve(spec)
}

const cache = new Map<string, vm.SourceTextModule>()

const loadModule = async (path: string): Promise<vm.SourceTextModule> => {
  if (cache.has(path)) return cache.get(path)!
  const { outputText } = ts.transpileModule(await readFile(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      esModuleInterop: true
    },
    fileName: path
  })
  const mod = new vm.SourceTextModule(outputText, {
    identifier: path,
    initializeImportMeta(meta){ meta.url = pathToFileURL(path).href },
    async importModuleDynamically(spec){
      return { namespace: await importTs(resolveImport(spec, path)) }
    }
  })
  cache.set(path, mod)
  await mod.link(async (spec) => loadModule(resolveImport(spec, path)))
  return mod
}

const importTs = async <TModule = Record<string, unknown>>(path: string): Promise<TModule> => {
  const mod = await loadModule(path)
  if (mod.status !== 'evaluated') await mod.evaluate()
  return mod.namespace as TModule
}

const importPolicyModule = () =>
  importTs<typeof import('../../../src/lib/autosave/policy.ts')>(
    join(root, 'src/lib/autosave/policy.ts')
  )

const importRootModule = () =>
  importTs<typeof import('../../../src/lib/autosave.ts')>(join(root, 'src/lib/autosave.ts'))

test('autosave policy module exposes frozen canonical policy', async () => {
  const { AUTOSAVE_POLICY, resolveAutoSavePolicy } = await importPolicyModule()
  assert.ok(Object.isFrozen(AUTOSAVE_POLICY), 'policy must be frozen to prevent runtime mutation')
  assert.deepEqual(resolveAutoSavePolicy(), AUTOSAVE_POLICY)
})

test('autosave root module re-exports policy facade', async () => {
  const root = await importRootModule()
  const policy = await importPolicyModule()
  assert.strictEqual(root.AUTOSAVE_POLICY, policy.AUTOSAVE_POLICY)
  assert.strictEqual(root.resolveAutoSavePolicy, policy.resolveAutoSavePolicy)
  assert.strictEqual(root.AUTOSAVE_DEFAULTS, policy.AUTOSAVE_DEFAULTS)
  assert.strictEqual(root.AUTOSAVE_MAX_BYTES, policy.AUTOSAVE_MAX_BYTES)
})
