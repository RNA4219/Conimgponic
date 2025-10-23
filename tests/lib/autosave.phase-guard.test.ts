import { test } from 'node:test'; import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'; import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'; import { createRequire } from 'node:module'
import vm from 'node:vm'; import ts from 'typescript'

type SetupOverrides = { navigator?: any; locks?: any; opfs?: { beforeWrite?: (path: string) => void } }
type FlagSnapshot = { readonly autosave: { readonly enabled: boolean; readonly phase: 'phase-a'; readonly source: string } }

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)))
const req = createRequire(import.meta.url)
const cache = new Map<string, vm.SourceTextModule>()
const withExt = (spec: string) => (spec.endsWith('.ts') || spec.endsWith('.js') ? spec : `${spec}.ts`)
const resolveImport = (spec: string, parent: string) => (spec.startsWith('.') || spec.startsWith('/') ? resolve(dirname(parent), withExt(spec)) : req.resolve(spec, { paths: [dirname(parent)] }))
const loadModule = async (path: string) => {
  if (cache.has(path)) return cache.get(path)!
  const { outputText } = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020, moduleResolution: ts.ModuleResolutionKind.NodeNext, esModuleInterop: true }, fileName: path })
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
const createOpfs = (hooks: SetupOverrides['opfs'] = {}) => {
  const files = new Map<string, string>(), dirs = new Map<string, any>()
  const makeDir = (prefix: string): any => {
    if (dirs.has(prefix)) return dirs.get(prefix)
    const dir = {
      async getDirectoryHandle(name: string){ return makeDir(join(prefix, name)) },
      async getFileHandle(name: string){ const full = join(prefix, name).replace(/^\/+/, ''); return { async createWritable(){ return { async write(data: string){ hooks?.beforeWrite?.(full); files.set(full, data) }, async close(){} } }, async getFile(){ if (!files.has(full)) throw new Error('missing file'); const text = files.get(full)!; return { async text(){ return text } } } } },
      async removeEntry(name: string){ files.delete(join(prefix, name).replace(/^\/+/, '')) },
      async *entries(){ const seen = new Set<string>(); for (const key of files.keys()){ if (!key.startsWith(prefix)) continue; const head = key.slice(prefix.length).replace(/^\//, '').split('/')[0]; if (head && !seen.has(head)){ seen.add(head); yield [head, {}] as const } } }
    }
    dirs.set(prefix, dir)
    return dir
  }
  return { files, storage: { async getDirectory(){ return makeDir('') } } }
}
const createFlags = (enabled: boolean): FlagSnapshot => ({ autosave: { enabled, phase: 'phase-a', source: enabled ? 'env' : 'config' } })
const setup = async (t: any, overrides: SetupOverrides = {}) => {
  cache.clear()
  const opfs = createOpfs(overrides.opfs)
  const navigatorValue = { storage: opfs.storage, locks: { async request(_: string, cb: any){ return cb({ async release(){} }) }, ...overrides.locks }, ...overrides.navigator }
  Object.defineProperty(globalThis, 'navigator', { value: navigatorValue, configurable: true })
  t.after(() => delete (globalThis as any).navigator)
  return { ...(await importTs(join(root, 'src/lib/autosave.ts'))), opfs }
}
const scenario = (name: string, overrides: any, fn?: any) => test(name, async (t) => { const handler = typeof overrides === 'function' ? overrides : fn; const ctx = await setup(t, typeof overrides === 'function' ? {} : overrides); await handler(t, ctx) })

scenario('phase guard stops runner when flag disabled', async (_t: any, { initAutoSave }: any) => {
  const flags = createFlags(false)
  const runner = initAutoSave(() => ({ nodes: [] } as any), { disabled: false }, flags)
  assert.equal(runner.snapshot().phase, 'disabled')
  await assert.rejects(runner.flushNow(), (error: any) => error?.code === 'disabled' && error?.retryable === false)
})

scenario('phase guard keeps dirty snapshot when enabled and generation queued', async (_t: any, { initAutoSave }: any) => {
  const flags = createFlags(true)
  const runner = initAutoSave(() => ({ nodes: [{ id: 'a' }] } as any), { disabled: false }, flags)
  runner.markDirty({ reason: 'test' })
  assert.equal(runner.snapshot().phase, 'dirty')
  assert.equal(runner.snapshot().retryCount, 0)
})

scenario('saving phase holds lock before history write', async (_t: any, { initAutoSave }: any) => {
  const flags = createFlags(true)
  const runner = initAutoSave(() => ({ nodes: [] } as any), { disabled: false }, flags)
  await runner.flushNow()
  assert.equal(runner.snapshot().phase, 'idle')
  assert.ok(runner.snapshot().lastSuccessAt)
})

scenario('backoff phase surfaces retryable error when Web Lock fails and .lock fallback pending', { locks: { async request(){ throw new Error('denied') } } }, async (_t: any, { initAutoSave }: any) => {
  const flags = createFlags(true)
  const runner = initAutoSave(() => ({ nodes: [] } as any), { disabled: false }, flags)
  await assert.rejects(runner.flushNow(), (error: any) => error?.code === 'lock-unavailable' && error?.retryable === true)
  assert.equal(runner.snapshot().phase, 'backoff')
  assert.equal(runner.snapshot().lastError?.code, 'lock-unavailable')
})

scenario('history fifo surfaces retained entries via listHistory metadata', async (_t: any, { initAutoSave, listHistory }: any) => {
  const flags = createFlags(true)
  const runner = initAutoSave(() => ({ nodes: [{ id: 'unit' }] } as any), { disabled: false }, flags)
  for (let i = 0; i < 24; i++) {
    runner.markDirty({ pendingBytes: 32 })
    await runner.flushNow()
  }
  const history = await listHistory()
  assert.ok(history.length <= 20)
  assert.ok(history.every((entry) => entry.location === 'history' && entry.retained))
  for (let i = 1; i < history.length; i++) {
    assert.ok(history[i - 1].ts <= history[i].ts)
  }
})

scenario(
  'write failure transitions runner to error phase with retryable AutoSaveError',
  { opfs: { beforeWrite(path){ if (path.endsWith('current.json.tmp')) throw new Error('disk-full') } } },
  async (_t: any, { initAutoSave }: any) => {
    const flags = createFlags(true)
    const runner = initAutoSave(() => ({ nodes: [{ id: 'x' }] } as any), { disabled: false }, flags)
    await assert.rejects(
      runner.flushNow(),
      (error: any) => error?.code === 'write-failed' && error?.retryable === true
    )
    const snap = runner.snapshot()
    assert.equal(snap.phase, 'error')
    assert.equal(snap.lastError?.code, 'write-failed')
    assert.ok(snap.retryCount >= 1)
  }
)

scenario(
  'non-retryable history overflow downgrades snapshot to disabled',
  {
    opfs: {
      beforeWrite(path){
        if (path.endsWith('index.json.tmp')){
          const error = Object.assign(new Error('history overflow'), {
            code: 'history-overflow',
            retryable: false
          })
          throw error
        }
      }
    }
  },
  async (_t: any, { initAutoSave }: any) => {
    const flags = createFlags(true)
    const runner = initAutoSave(() => ({ nodes: [{ id: 'overflow' }] } as any), { disabled: false }, flags)
    await assert.rejects(
      runner.flushNow(),
      (error: any) => error?.code === 'history-overflow' && error?.retryable === false
    )
    const snap = runner.snapshot()
    assert.equal(snap.phase, 'disabled')
    assert.equal(snap.lastError?.code, 'history-overflow')
    assert.equal(snap.retryCount, 0)
  }
)
