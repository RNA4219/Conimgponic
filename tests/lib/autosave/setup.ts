import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

import type * as AutoSaveModule from '../../../src/lib/autosave'
import type {
  AutoSaveInitResult,
  AutoSavePhaseGuardSnapshot,
  AutoSaveTelemetryEvent
} from '../../../src/lib/autosave'

interface LockHandleLike {
  release(): Promise<void>
}

type LockRequestCallback = (lock: LockHandleLike) => Promise<unknown> | unknown

interface LockRequestOptions {
  readonly mode?: 'exclusive' | 'shared'
  readonly signal?: AbortSignal
}

interface LockManagerLike {
  request(
    name: string,
    optionsOrCallback: LockRequestOptions | LockRequestCallback,
    callback?: LockRequestCallback
  ): Promise<unknown>
}

interface NavigatorOverrides {
  readonly storage?: { getDirectory(): Promise<DirectoryHandleLike> }
  readonly locks?: Partial<LockManagerLike>
  readonly [key: string]: unknown
}

export interface SetupOverrides {
  readonly navigator?: NavigatorOverrides
  readonly locks?: Partial<LockManagerLike>
  readonly importMetaEnv?: Record<string, unknown>
}

export const ENABLED_GUARD: AutoSavePhaseGuardSnapshot = Object.freeze({
  featureFlag: { value: true, source: 'env' },
  optionsDisabled: false
})

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const req = createRequire(import.meta.url)
const cache = new Map<string, vm.SourceTextModule>()

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
  return req.resolve(spec, { paths: [dirname(parent)] })
}

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
    initializeImportMeta(meta){
      meta.url = pathToFileURL(path).href
      const scope = globalThis as { __IMPORT_META_ENV__?: Record<string, unknown> }
      if (scope.__IMPORT_META_ENV__ && typeof scope.__IMPORT_META_ENV__ === 'object') {
        meta.env = scope.__IMPORT_META_ENV__
      }
    },
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

type AutoSaveTestModule = AutoSaveModule & {
  opfs: OpfsMock
  collectorEvents: Array<Record<string, unknown>>
  runnerTelemetry: RunnerTelemetryEvent[]
  guardSnapshots: AutoSavePhaseGuardSnapshot[]
}

export const setup = async (t: TestContext, overrides: SetupOverrides = {}): Promise<AutoSaveTestModule> => {
  cache.clear()
  const importMetaScope = globalThis as { __IMPORT_META_ENV__?: Record<string, unknown> }
  const previousImportMetaEnv = importMetaScope.__IMPORT_META_ENV__
  if (overrides.importMetaEnv !== undefined) {
    importMetaScope.__IMPORT_META_ENV__ = overrides.importMetaEnv
    t.after(() => {
      if (previousImportMetaEnv === undefined) {
        delete importMetaScope.__IMPORT_META_ENV__
      } else {
        importMetaScope.__IMPORT_META_ENV__ = previousImportMetaEnv
      }
    })
  }
  const opfs = createOpfs()
  const collectorEvents: Array<Record<string, unknown>> = []
  const runnerTelemetry: RunnerTelemetryEvent[] = []
  const guardSnapshots: AutoSavePhaseGuardSnapshot[] = []
  const collectorScope = globalThis as {
    Day8Collector?: { publish?: (event: Record<string, unknown>) => void }
  }
  const previousCollector = collectorScope.Day8Collector
  collectorScope.Day8Collector = {
    publish(event: Record<string, unknown>) {
      collectorEvents.push(event)
    }
  }
  const runnerHostScope = globalThis as {
    __AUTOSAVE_RUNNER_HOST__?: {
      telemetry?: (event: RunnerTelemetryEvent) => void
      [key: string]: unknown
    }
  }
  const previousRunnerHost = runnerHostScope.__AUTOSAVE_RUNNER_HOST__
  runnerHostScope.__AUTOSAVE_RUNNER_HOST__ = {
    ...(typeof previousRunnerHost === 'object' && previousRunnerHost !== null ? previousRunnerHost : {}),
    telemetry(event: RunnerTelemetryEvent) {
      runnerTelemetry.push(event)
      const legacy =
        previousRunnerHost && typeof previousRunnerHost === 'object'
          ? (previousRunnerHost.telemetry as ((event: RunnerTelemetryEvent) => void) | undefined)
          : undefined
      legacy?.(event)
    }
  }
  const navigatorValue = {
    storage: opfs.storage,
    locks: {
      async request(
        _: string,
        optionsOrCallback: LockRequestOptions | LockRequestCallback,
        callback?: LockRequestCallback
      ){
        const handler = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback
        if (typeof handler !== 'function') throw new TypeError('Lock request callback missing')
        return handler({ async release(){} })
      },
      ...overrides.locks
    },
    ...overrides.navigator
  }
  Object.defineProperty(globalThis, 'navigator', { value: navigatorValue, configurable: true })
  t.after(() => {
    if (previousCollector === undefined) {
      delete collectorScope.Day8Collector
    } else {
      collectorScope.Day8Collector = previousCollector
    }
  })
  t.after(() => {
    if (previousRunnerHost === undefined) {
      delete runnerHostScope.__AUTOSAVE_RUNNER_HOST__
    } else {
      runnerHostScope.__AUTOSAVE_RUNNER_HOST__ = previousRunnerHost
    }
  })
  const runners: AutoSaveInitResult[] = []
  t.after(async () => {
    const registered = runners.splice(0)
    for (const runner of registered) {
      await runner.dispose()
    }
  })
  t.after(() => {
    delete (globalThis as { navigator?: unknown }).navigator
  })
  const module = await importTs<AutoSaveModule>(join(root, 'src/lib/autosave.ts'))
  const initAutoSave: AutoSaveModule['initAutoSave'] = (
    ...args: Parameters<AutoSaveModule['initAutoSave']>
  ) => {
    const runner = module.initAutoSave(...args)
    const guardCandidate = args[2]
    if (guardCandidate && typeof guardCandidate === 'object') {
      guardSnapshots.push(guardCandidate as AutoSavePhaseGuardSnapshot)
    }
    runners.push(runner)
    return runner
  }
  return { ...module, initAutoSave, opfs, collectorEvents, runnerTelemetry, guardSnapshots }
}

export type RunnerTelemetryEvent = AutoSaveTelemetryEvent & {
  readonly slo: 'p99-success' | 'p95-latency'
}

export type ScenarioContext = Awaited<ReturnType<typeof setup>>

type ScenarioHandler = (t: TestContext, ctx: ScenarioContext) => unknown | Promise<unknown>

export function scenario(name: string, handler: ScenarioHandler): void
export function scenario(name: string, overrides: SetupOverrides, handler: ScenarioHandler): void
export function scenario(name: string, overridesOrHandler: SetupOverrides | ScenarioHandler, handler?: ScenarioHandler): void {
  test(name, async (t) => {
    const actualHandler = typeof overridesOrHandler === 'function' ? overridesOrHandler : handler!
    const ctx = await setup(t, typeof overridesOrHandler === 'function' ? {} : overridesOrHandler)
    const runners = new Set<AutoSaveInitResult>()
    const trackRunner = <TRunner extends AutoSaveInitResult>(runner: TRunner): TRunner => {
      const originalDispose = runner.dispose.bind(runner)
      let disposed = false
      runner.dispose = async () => {
        if (disposed) return
        disposed = true
        runners.delete(runner)
        await originalDispose()
      }
      runners.add(runner)
      return runner
    }
    t.after(async () => {
      const pending = Array.from(runners).map((runner) => runner.dispose())
      await Promise.all(pending)
    })
    const trackedCtx = {
      ...ctx,
      initAutoSave: ((...args: Parameters<typeof ctx.initAutoSave>) =>
        trackRunner(ctx.initAutoSave(...args))) as typeof ctx.initAutoSave
    }
    await actualHandler(t, trackedCtx)
  })
}
