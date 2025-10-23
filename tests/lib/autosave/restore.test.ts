import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url))),
  req = createRequire(import.meta.url),
  cache = new Map<string, vm.SourceTextModule>()

const resolveImport = (spec: string, parent: string) =>
  spec.startsWith('.') || spec.startsWith('/')
    ? resolve(dirname(parent), spec.endsWith('.ts') || spec.endsWith('.js') ? spec : `${spec}.ts`)
    : req.resolve(spec, { paths: [dirname(parent)] })

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
    initializeImportMeta(meta) { meta.url = pathToFileURL(path).href },
    async importModuleDynamically(spec) {
      return { namespace: await importTs(resolveImport(spec, path)) }
    }
  })
  cache.set(path, mod)
  await mod.link((spec) => loadModule(resolveImport(spec, path)))
  return mod
}

const importTs = async (path: string) => {
  const mod = await loadModule(path)
  if (mod.status !== 'evaluated') await mod.evaluate()
  return mod.namespace as any
}
const createOpfs = () => {
  const files = new Map<string, string>()
  const makeDir = (prefix: string): any => ({
    async getDirectoryHandle(name: string) { return makeDir(join(prefix, name)) },
    async getFileHandle(name: string) {
      const full = join(prefix, name).replace(/^\/+/, '')
      return {
        async getFile() {
          if (!files.has(full)) throw new Error('missing file')
          const text = files.get(full)!
          return { async text() { return text } }
        }
      }
    }
  })
  return { files, storage: { async getDirectory() { return makeDir('') } } }
}

const setup = async (t: any) => {
  cache.clear()
  const opfs = createOpfs()
  Object.defineProperty(globalThis, 'navigator', { value: { storage: opfs.storage }, configurable: true })
  t.after(() => delete (globalThis as any).navigator)
  return { ...(await importTs(join(root, 'src/lib/autosave.ts'))), opfs }
}
const encodeBytes = (value: object) => Buffer.byteLength(JSON.stringify(value))
const scenario = (name: string, handler: (ctx: any) => Promise<void>) =>
  test(name, async (t) => { const ctx = await setup(t); await handler(ctx) })
scenario('restorePrompt prioritises latest entry and restores storyboards', async (ctx: any) => {
  const { restorePrompt, restoreFromCurrent, restoreFrom, listHistory, opfs } = ctx
  const current = { id: 'story-current', title: 'Current', scenes: [], selection: [], version: 1 }
  const historyTs = '2024-01-01T00:00:00.000Z'
  const history = { id: 'story-history', title: 'History', scenes: [], selection: [], version: 1 }
  opfs.files.set('project/autosave/current.json', JSON.stringify(current))
  opfs.files.set(`project/autosave/history/${historyTs}.json`, JSON.stringify(history))
  opfs.files.set(
    'project/autosave/index.json',
    JSON.stringify([
      { ts: '2024-02-01T00:00:00.000Z', bytes: encodeBytes(current), location: 'current', retained: true },
      { ts: historyTs, bytes: encodeBytes(history), location: 'history', retained: true }
    ])
  )
  const meta = await restorePrompt()
  assert.deepEqual(meta, {
    ts: '2024-02-01T00:00:00.000Z',
    bytes: encodeBytes(current),
    source: 'current',
    location: 'project/autosave/current.json'
  })
  assert.deepEqual(await restoreFromCurrent(), current)
  assert.deepEqual(await restoreFrom(historyTs), history)
  assert.deepEqual(await listHistory(), [{ ts: historyTs, bytes: encodeBytes(history), location: 'history', retained: true }])
})

scenario('restorePrompt rejects corrupted index with AutoSaveError(data-corrupted)', async (ctx: any) => {
  const { restorePrompt, opfs } = ctx
  opfs.files.set('project/autosave/index.json', '{')
  await assert.rejects(restorePrompt(), (error: any) => error?.code === 'data-corrupted' && error?.retryable === false)
})

scenario('restoreFrom rejects missing history with AutoSaveError(history-overflow)', async (ctx: any) => {
  const { restoreFrom, opfs } = ctx
  const missingTs = '2023-12-24T10:20:30.000Z'
  opfs.files.set(
    'project/autosave/index.json',
    JSON.stringify([{ ts: missingTs, bytes: 0, location: 'history', retained: true }])
  )
  await assert.rejects(restoreFrom(missingTs), (error: any) => error?.code === 'history-overflow' && error?.retryable === false)
})
