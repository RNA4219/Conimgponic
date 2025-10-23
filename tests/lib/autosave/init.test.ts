import { test } from 'node:test'; import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'; import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'; import { createRequire } from 'node:module'
import vm from 'node:vm'; import ts from 'typescript'
type SetupOverrides = { navigator?: any; locks?: any }
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const req = createRequire(import.meta.url)
const cache = new Map<string, vm.SourceTextModule>()
const withExt = (spec: string) => (spec.endsWith('.ts') || spec.endsWith('.js') ? spec : `${spec}.ts`)
const resolveImport = (spec: string, parent: string) =>
  spec.startsWith('.') || spec.startsWith('/')
    ? resolve(dirname(parent), withExt(spec))
    : req.resolve(spec, { paths: [dirname(parent)] })

const loadModule = async (path: string) => {
  if (cache.has(path)) return cache.get(path)!
  const { outputText } = ts.transpileModule(await readFile(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020, moduleResolution: ts.ModuleResolutionKind.NodeNext, esModuleInterop: true },
    fileName: path
  })
  const mod = new vm.SourceTextModule(outputText, {
    identifier: path,
    initializeImportMeta(meta){ meta.url = pathToFileURL(path).href },
    async importModuleDynamically(spec){ return { namespace: await importTs(resolveImport(spec, path)) } }
  })
  cache.set(path, mod)
  await mod.link(async (spec) => loadModule(resolveImport(spec, path)))
  return mod
}

const importTs = async (path: string) => { const mod = await loadModule(path); if (mod.status !== 'evaluated') await mod.evaluate(); return mod.namespace as any }

const createOpfs = () => {
  const files = new Map<string, string>(), dirs = new Map<string, any>()
  const makeDir = (prefix: string): any => {
    if (dirs.has(prefix)) return dirs.get(prefix)
    const dir = {
      async getDirectoryHandle(name: string){ return makeDir(join(prefix, name)) },
      async getFileHandle(name: string){ const full = join(prefix, name).replace(/^\/+/, ''); return { async createWritable(){ return { async write(data: string){ files.set(full, data) }, async close(){} } }, async getFile(){ if (!files.has(full)) throw new Error('missing file'); const text = files.get(full)!; return { async text(){ return text } } } } },
      async removeEntry(name: string){ files.delete(join(prefix, name).replace(/^\/+/, '')) },
      async *entries(){ const seen = new Set<string>(); for (const key of files.keys()){ if (!key.startsWith(prefix)) continue; const head = key.slice(prefix.length).replace(/^\//, '').split('/')[0]; if (head && !seen.has(head)){ seen.add(head); yield [head, {}] as const } } }
    }
    dirs.set(prefix, dir); return dir
  }
  return { files, storage: { async getDirectory(){ return makeDir('') } } }
}

const setup = async (t: any, overrides: SetupOverrides = {}) => {
  cache.clear()
  const opfs = createOpfs()
  const navigatorValue = {
    storage: opfs.storage,
    locks: { async request(_: string, cb: any){ return cb({ async release(){} }) }, ...overrides.locks },
    ...overrides.navigator
  }
  Object.defineProperty(globalThis, 'navigator', { value: navigatorValue, configurable: true })
  Object.defineProperty(globalThis as any, '__AUTOSAVE_ENABLED__', { value: true, configurable: true, writable: true })
  t.after(() => delete (globalThis as any).navigator)
  t.after(() => delete (globalThis as any).__AUTOSAVE_ENABLED__)
  return { ...(await importTs(join(root, 'src/lib/autosave.ts'))), opfs }
}

const scenario = (name: string, overrides: any, fn?: any) => test(name, async (t) => {
  const handler = typeof overrides === 'function' ? overrides : fn
  const ctx = await setup(t, typeof overrides === 'function' ? {} : overrides)
  await handler(t, ctx)
})

scenario('flushNow persists storyboard and restorePrompt exposes metadata', async (t: any, { initAutoSave, restorePrompt, opfs }: any) => {
  const runner = initAutoSave(() => ({ nodes: [{ id: 'hero' }] } as any), { disabled: false })
  await runner.flushNow()
  const meta = await restorePrompt()
  assert.equal(runner.snapshot().phase, 'idle')
  assert.ok(opfs.files.has('project/autosave/current.json')); assert.ok(opfs.files.has('project/autosave/index.json'))
  assert.ok(!opfs.files.has('project/autosave/current.json.tmp')); assert.ok(!opfs.files.has('project/autosave/index.json.tmp'))
  assert.ok(Array.from(opfs.files.keys()).some((key) => key.startsWith('project/autosave/history/')))
  const index = JSON.parse(opfs.files.get('project/autosave/index.json')!)
  assert.ok(Array.isArray(index.entries)); assert.equal(runner.snapshot().retryCount, 0); assert.equal(runner.snapshot().pendingBytes, 0)
  assert.ok(typeof runner.snapshot().lastSuccessAt === 'string'); for (const key of opfs.files.keys()) assert.ok(!key.endsWith('.tmp'))
  assert.equal(meta?.source, 'current')
})

scenario('history rotation keeps at most 20 generations', async (_t: any, { initAutoSave, opfs }: any) => {
  const runner = initAutoSave(() => ({ nodes: [] } as any), { disabled: false })
  for (let i = 0; i < 22; i++) await runner.flushNow()
  assert.ok(Array.from(opfs.files.keys()).filter((k) => k.startsWith('project/autosave/history/')).length <= 20)
})

scenario('disabled guard returns no-op handle', async (_t: any, { initAutoSave }: any) => {
  for (const { flag, options } of [
    { flag: false, options: { disabled: false } },
    { flag: true, options: { disabled: true } }
  ]) {
    ;(globalThis as any).__AUTOSAVE_ENABLED__ = flag; const runner = initAutoSave(() => ({ nodes: [] } as any), options)
    assert.equal(runner.snapshot().phase, 'disabled')
    await assert.rejects(runner.flushNow(), (error: any) => error?.code === 'disabled' && error?.retryable === false)
  }
})

scenario(
  'lock failure surfaces AutoSaveError with retryable flag',
  { locks: { async request(){ throw new Error('denied') } } },
  async (_t: any, { initAutoSave }: any) => {
    const runner = initAutoSave(() => ({ nodes: [] } as any), { disabled: false })
    await assert.rejects(runner.flushNow(), (error: any) => error?.code === 'lock-unavailable' && error?.retryable === true)
  }
)
