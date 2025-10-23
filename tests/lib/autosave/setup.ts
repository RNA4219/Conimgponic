import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

export type SetupOverrides = { navigator?: any; locks?: any }

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

export const importTs = async (path: string) => {
  const mod = await loadModule(path)
  if (mod.status !== 'evaluated') await mod.evaluate()
  return mod.namespace as any
}

export const createOpfs = () => {
  const files = new Map<string, string>()
  const dirs = new Map<string, any>()
  const makeDir = (prefix: string): any => {
    if (dirs.has(prefix)) return dirs.get(prefix)
    const dir = {
      async getDirectoryHandle(name: string){
        return makeDir(join(prefix, name))
      },
      async getFileHandle(name: string){
        const full = join(prefix, name).replace(/^\/+/, '')
        return {
          async createWritable(){
            return {
              async write(data: string){ files.set(full, data) },
              async close(){}
            }
          },
          async getFile(){
            if (!files.has(full)) throw new Error('missing file')
            const text = files.get(full)!
            return { async text(){ return text } }
          }
        }
      },
      async removeEntry(name: string){
        files.delete(join(prefix, name).replace(/^\/+/, ''))
      },
      async *entries(){
        const seen = new Set<string>()
        for (const key of files.keys()){
          if (!key.startsWith(prefix)) continue
          const head = key.slice(prefix.length).replace(/^\//, '').split('/')[0]
          if (head && !seen.has(head)){
            seen.add(head)
            yield [head, {}] as const
          }
        }
      }
    }
    dirs.set(prefix, dir)
    return dir
  }
  return { files, storage: { async getDirectory(){ return makeDir('') } } }
}

export const setup = async (t: TestContext, overrides: SetupOverrides = {}) => {
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

type ScenarioHandler = (t: TestContext, ctx: Awaited<ReturnType<typeof setup>>) => unknown | Promise<unknown>

type ScenarioOverrides = SetupOverrides | ScenarioHandler

export const scenario = (name: string, overrides: ScenarioOverrides, handler?: ScenarioHandler) =>
  test(name, async (t) => {
    const actualHandler = typeof overrides === 'function' ? overrides : handler!
    const ctx = await setup(t, typeof overrides === 'function' ? {} : overrides)
    await actualHandler(t, ctx)
  })
