import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

import type * as AutoSaveModule from '../../../src/lib/autosave'

interface LockHandleLike {
  release(): Promise<void>
}

type LockRequestCallback = (lock: LockHandleLike) => Promise<unknown> | unknown

interface LockManagerLike {
  request(name: string, callback: LockRequestCallback): Promise<unknown>
}

interface NavigatorOverrides {
  readonly storage?: { getDirectory(): Promise<DirectoryHandleLike> }
  readonly locks?: Partial<LockManagerLike>
  readonly [key: string]: unknown
}

export interface SetupOverrides {
  readonly navigator?: NavigatorOverrides
  readonly locks?: Partial<LockManagerLike>
}

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const req = createRequire(import.meta.url)
const cache = new Map<string, vm.SourceTextModule>()

const withExt = (spec: string): string => (spec.endsWith('.ts') || spec.endsWith('.js') ? spec : `${spec}.ts`)

const resolveImport = (spec: string, parent: string): string =>
  spec.startsWith('.') || spec.startsWith('/')
    ? resolve(dirname(parent), withExt(spec))
    : req.resolve(spec, { paths: [dirname(parent)] })

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

export const importTs = async <TModule = Record<string, unknown>>(path: string): Promise<TModule> => {
  const mod = await loadModule(path)
  if (mod.status !== 'evaluated') await mod.evaluate()
  return mod.namespace as TModule
}

interface WritableLike {
  write(data: string): Promise<void>
  close(): Promise<void>
}

interface FileHandleLike {
  createWritable(): Promise<WritableLike>
  getFile(): Promise<{ text(): Promise<string> }>
}

interface DirectoryHandleLike {
  getDirectoryHandle(name: string): Promise<DirectoryHandleLike>
  getFileHandle(name: string): Promise<FileHandleLike>
  removeEntry(name: string): Promise<void>
  entries(): AsyncGenerator<readonly [string, Record<string, never>], void, unknown>
}

export interface OpfsMock {
  readonly files: Map<string, string>
  readonly storage: { getDirectory(): Promise<DirectoryHandleLike> }
}

export const createOpfs = (): OpfsMock => {
  const files = new Map<string, string>()
  const dirs = new Map<string, DirectoryHandleLike>()
  const makeDir = (prefix: string): DirectoryHandleLike => {
    if (dirs.has(prefix)) return dirs.get(prefix)!
    const dir: DirectoryHandleLike = {
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

type AutoSaveTestModule = AutoSaveModule & { opfs: OpfsMock }

export const setup = async (t: TestContext, overrides: SetupOverrides = {}): Promise<AutoSaveTestModule> => {
  cache.clear()
  const opfs = createOpfs()
  const navigatorValue = {
    storage: opfs.storage,
    locks: {
      async request(_: string, cb: LockRequestCallback){
        return cb({ async release(){} })
      },
      ...overrides.locks
    },
    ...overrides.navigator
  }
  Object.defineProperty(globalThis, 'navigator', { value: navigatorValue, configurable: true })
  t.after(() => {
    delete (globalThis as { navigator?: unknown }).navigator
  })
  return { ...(await importTs<AutoSaveModule>(join(root, 'src/lib/autosave.ts'))), opfs }
}

type ScenarioContext = Awaited<ReturnType<typeof setup>>

type ScenarioHandler = (t: TestContext, ctx: ScenarioContext) => unknown | Promise<unknown>

export function scenario(name: string, handler: ScenarioHandler): void
export function scenario(name: string, overrides: SetupOverrides, handler: ScenarioHandler): void
export function scenario(name: string, overridesOrHandler: SetupOverrides | ScenarioHandler, handler?: ScenarioHandler): void {
  test(name, async (t) => {
    const actualHandler = typeof overridesOrHandler === 'function' ? overridesOrHandler : handler!
    const ctx = await setup(t, typeof overridesOrHandler === 'function' ? {} : overridesOrHandler)
    await actualHandler(t, ctx)
  })
}
