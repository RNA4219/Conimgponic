import { test } from 'node:test'; import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'; import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'; import { createRequire } from 'node:module'
import vm from 'node:vm'; import ts from 'typescript'

type SetupOverrides = { navigator?: any; locks?: any }
type CollectorEvent = {
  readonly schema: 'vscode.telemetry.v1'
  readonly event: string
  readonly payload: any
}

type FlagSnapshot = {
  readonly autosave: { readonly enabled: boolean; readonly phase: 'A-1'; readonly source: 'env' }
}

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const req = createRequire(import.meta.url)
const cache = new Map<string, vm.SourceTextModule>()
const withExt = (spec: string) => (spec.endsWith('.ts') || spec.endsWith('.js') ? spec : `${spec}.ts`)
const resolveImport = (spec: string, parent: string) =>
  spec.startsWith('.') || spec.startsWith('/') ? resolve(dirname(parent), withExt(spec)) : req.resolve(spec, { paths: [dirname(parent)] })

const loadModule = async (path: string) => {
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
    async importModuleDynamically(spec){ return { namespace: await importTs(resolveImport(spec, path)) } }
  })
  cache.set(path, mod)
  await mod.link(async (spec) => loadModule(resolveImport(spec, path)))
  return mod
}

const importTs = async (path: string) => {
  const mod = await loadModule(path)
  if (mod.status !== 'evaluated') await mod.evaluate()
  return mod.namespace as any
}

const createOpfs = () => {
  const files = new Map<string, string>(), dirs = new Map<string, any>()
  const makeDir = (prefix: string): any => {
    if (dirs.has(prefix)) return dirs.get(prefix)
    const dir = {
      async getDirectoryHandle(name: string){ return makeDir(join(prefix, name)) },
      async getFileHandle(name: string){
        const full = join(prefix, name).replace(/^\/+/, '')
        return {
          async createWritable(){
            return {
              async write(data: string){ files.set(full, data) },
              async close(){},
              async abort(){ files.delete(full) }
            }
          },
          async getFile(){
            if (!files.has(full)) throw new Error('missing file')
            const text = files.get(full)!
            return { async text(){ return text } }
          }
        }
      },
      async removeEntry(name: string){ files.delete(join(prefix, name).replace(/^\/+/, '')) }
    }
    dirs.set(prefix, dir)
    return dir
  }
  return { files, storage: { async getDirectory(){ return makeDir('') } } }
}

const createFlags = (): FlagSnapshot => ({ autosave: { enabled: true, phase: 'A-1', source: 'env' } })

const setup = async (t: any, overrides: SetupOverrides = {}) => {
  cache.clear()
  const opfs = createOpfs()
  const navigatorValue = {
    storage: opfs.storage,
    locks: { async request(_: string, cb: any){ return cb({ async release(){} }) }, ...overrides.locks },
    ...overrides.navigator
  }
  Object.defineProperty(globalThis, 'navigator', { value: navigatorValue, configurable: true })
  t.after(() => delete (globalThis as any).navigator)
  return { ...(await importTs(join(root, 'src/lib/autosave.ts'))), opfs }
}

const scenario = (name: string, overrides: any, fn?: any) =>
  test(name, async (t) => {
    const handler = typeof overrides === 'function' ? overrides : fn
    const ctx = await setup(t, typeof overrides === 'function' ? {} : overrides)
    await handler(t, ctx)
  })

const createClock = () => {
  const base = Date.UTC(2025, 0, 1, 0, 0, 0)
  let tick = 0
  return () => new Date(base + tick++ * 150)
}

scenario('flushNow emits collector events with Day8 schema', async (_t: any, { initAutoSave }: any) => {
  const events: CollectorEvent[] = []
  const clock = createClock()
  const flags = createFlags()
  const runner = initAutoSave(
    () => ({ nodes: [{ id: 'root' }] } as any),
    { disabled: false },
    flags,
    {
      clock,
      collector(event: CollectorEvent){ events.push(event) },
      correlationId: 'corr-1'
    }
  )

  runner.markDirty({ reason: 'test' })
  await runner.flushNow()

  const resolution = events.find((event) => event.event === 'flag_resolution')
  assert.ok(resolution, 'flag_resolution event should be emitted')
  assert.equal(resolution.payload.flag, 'autosave.enabled')
  assert.equal(resolution.payload.variant, 'enabled')
  assert.equal(resolution.payload.source, 'env')
  assert.equal(resolution.payload.phase, 'A-1')

  const statusEvents = events.filter((event) => event.event === 'status.autosave')
  assert.ok(statusEvents.length >= 1)
  const finalStatus = statusEvents[statusEvents.length - 1]
  assert.equal(finalStatus.payload.guard.current, 'A-1')
  assert.equal(finalStatus.payload.guard.rollbackTo, 'A-1')
  assert.equal(finalStatus.payload.debounce_ms, 500)
  assert.equal(finalStatus.payload.phase_step, 'idle')
  assert.equal(finalStatus.payload.state, 'saved')
  assert.ok(finalStatus.payload.latency_ms >= 0)
  assert.ok(finalStatus.payload.latency_ms <= 2000)

  const result = events.find((event) => event.event === 'snapshot.result')
  assert.ok(result && result.payload.ok)
  assert.equal(result.payload.generation, 1)
  assert.ok(result.payload.bytes > 0)
})

scenario(
  'retryable error propagates collector telemetry',
  { locks: { async request(){ throw new Error('denied') } } },
  async (_t: any, { initAutoSave }: any) => {
    const events: CollectorEvent[] = []
    const clock = createClock()
    const flags = createFlags()
    const runner = initAutoSave(
      () => ({ nodes: [] } as any),
      { disabled: false },
      flags,
      {
        clock,
        collector(event: CollectorEvent){ events.push(event) },
        correlationId: 'corr-2'
      }
    )

    await assert.rejects(runner.flushNow(), (error: any) => error?.code === 'lock-unavailable' && error?.retryable === true)

    const statusEvents = events.filter((event) => event.event === 'status.autosave')
    assert.ok(statusEvents.length >= 1)
    const lastStatus = statusEvents[statusEvents.length - 1]
    assert.equal(lastStatus.payload.guard.current, 'A-1')
    assert.equal(lastStatus.payload.state, 'backoff')
    assert.equal(lastStatus.payload.phase_step, 'error')

    const snapshotEvents = events.filter((event) => event.event === 'snapshot.result')
    assert.ok(snapshotEvents.length >= 1)
    const lastSnapshot = snapshotEvents[snapshotEvents.length - 1]
    assert.equal(lastSnapshot.payload.ok, false)
    assert.equal(lastSnapshot.payload.error.code, 'lock-unavailable')
  }
)
