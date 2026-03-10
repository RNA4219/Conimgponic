import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  AutoSaveInitResult,
  AutoSavePhaseGuardSnapshot,
  AutoSaveTelemetryEvent
} from '../../../src/lib/autosave'
import type { FlagSnapshot } from '../../../src/config/flags'

interface LockHandleLike {
  release(): Promise<void>
}

type LockRequestCallback = (lock: LockHandleLike) => Promise<unknown> | unknown

interface LockRequestOptions {
  readonly mode?: 'exclusive' | 'shared'
  readonly signal?: AbortSignal
}

interface LockQueueEntry {
  readonly name: string
  readonly handler: LockRequestCallback
  readonly options: LockRequestOptions
  readonly originalSecondArg: LockRequestOptions | LockRequestCallback
  readonly signal?: AbortSignal
  resolve(value: unknown): void
  reject(reason?: unknown): void
  onAbort?: () => void
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

// Create a proper FlagSnapshot for testing
export const ENABLED_FLAG_SNAPSHOT: FlagSnapshot = Object.freeze({
  autosave: { value: true, source: 'env', errors: [] },
  plugins: { value: false, source: 'default', errors: [] },
  merge: { value: 'legacy', source: 'default', threshold: 0.8, errors: [] },
  updatedAt: new Date().toISOString()
})

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))

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
            if (!files.has(full)) {
              const error = new Error('missing file')
              error.name = 'NotFoundError'
              throw error
            }
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

export interface LocalStorageStub {
  readonly entries: Map<string, string>
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  clear(): void
}

export const createLocalStorageStub = (
  initial: Record<string, string> = {}
): LocalStorageStub => {
  const entries = new Map<string, string>(Object.entries(initial))
  const storage: LocalStorageStub = {
    entries,
    get length(){
      return entries.size
    },
    key(index: number){
      return Array.from(entries.keys())[index] ?? null
    },
    getItem(key: string){
      return entries.get(key) ?? null
    },
    setItem(key: string, value: string){
      entries.set(key, value)
    },
    removeItem(key: string){
      entries.delete(key)
    },
    clear(){
      entries.clear()
    }
  }
  return storage
}

interface AutoSaveTestModule {
  initAutoSave: typeof import('../../../src/lib/autosave').initAutoSave
  opfs: OpfsMock
  collectorEvents: Array<Record<string, unknown>>
  runnerTelemetry: RunnerTelemetryEvent[]
  guardSnapshots: AutoSavePhaseGuardSnapshot[]
  restorePrompt: () => Promise<{ source: string } | null>
}

export const setup = async (t: TestContext, overrides: SetupOverrides = {}): Promise<AutoSaveTestModule> => {
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
      ...(() => {
        const overrideLocks = overrides.locks ?? {}
        const overrideRequest = overrideLocks.request?.bind(overrideLocks)
        const queue: LockQueueEntry[] = []
        let active: LockQueueEntry | null = null
        const abortError = (): Error =>
          typeof DOMException === 'function'
            ? new DOMException('Lock request aborted', 'AbortError')
            : Object.assign(new Error('Lock request aborted'), { name: 'AbortError' })
        const schedule = () => {
          if (active || queue.length === 0) return
          active = queue.shift()!
          run(active)
        }
        const run = (entry: LockQueueEntry) => {
          if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort)
          if (entry.signal?.aborted) { entry.reject(abortError()); active = null; schedule(); return }
          let releaseCalled = false
          let releaseResolve: (() => void) | undefined
          const released = new Promise<void>((resolve) => (releaseResolve = resolve))
          const release = async () => { if (!releaseCalled) { releaseCalled = true; releaseResolve?.() } }
          const wrapHandle = (lock?: LockHandleLike): LockHandleLike & { released: Promise<void> } => {
            const incoming = lock && typeof lock === 'object' ? lock : undefined
            const releaseSource = incoming && typeof incoming.release === 'function' ? incoming.release.bind(incoming) : undefined
            return { ...(incoming ?? {}), release: async () => { if (releaseSource) { const maybe = releaseSource(); if (maybe && typeof (maybe as Promise<unknown>).then === 'function') await maybe } await release() }, released }
          }
          const execution =
            overrideRequest === undefined
              ? entry.handler(wrapHandle())
              : typeof entry.originalSecondArg === 'function'
                  ? overrideRequest(entry.name, (lock) => entry.handler(wrapHandle(lock as LockHandleLike)))
                  : overrideRequest(
                      entry.name,
                      entry.originalSecondArg as LockRequestOptions,
                      (lock) => entry.handler(wrapHandle(lock as LockHandleLike))
                    )
          Promise.resolve(execution).then(entry.resolve, entry.reject).finally(async () => {
            if (!releaseCalled) await release()
            await released
            active = null
            schedule()
          })
        }
        const request: LockManagerLike['request'] = (name, optionsOrCallback, callback) => {
          const handler = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback
          if (typeof handler !== 'function') throw new TypeError('Lock request callback missing')
          const options =
            typeof optionsOrCallback === 'function' ? ({} as LockRequestOptions) : (optionsOrCallback ?? {})
          const entry: LockQueueEntry = { name, handler, options, originalSecondArg: typeof optionsOrCallback === 'function' ? optionsOrCallback : options, signal: options.signal, resolve: () => undefined, reject: () => undefined }
          return new Promise<unknown>((resolve, reject) => {
            entry.resolve = resolve
            entry.reject = reject
            if (entry.signal?.aborted) { reject(abortError()); return }
            if (entry.signal) {
              const onAbort = () => {
                const index = queue.indexOf(entry)
                if (index !== -1) { queue.splice(index, 1); reject(abortError()); schedule() }
              }
              entry.onAbort = onAbort
              entry.signal.addEventListener('abort', onAbort, { once: true })
            }
            queue.push(entry)
            schedule()
          })
        }
        return { ...overrideLocks, request }
      })()
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

  // Dynamically import the autosave module
  const autosaveModule = await import('../../../src/lib/autosave.js')

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

  const initAutoSave: typeof autosaveModule.initAutoSave = (
    ...args: Parameters<typeof autosaveModule.initAutoSave>
  ) => {
    const runner = autosaveModule.initAutoSave(...args)
    const guardCandidate = args[2]
    if (guardCandidate && typeof guardCandidate === 'object') {
      guardSnapshots.push(guardCandidate as AutoSavePhaseGuardSnapshot)
    }
    runners.push(runner)
    return runner
  }

  // Restore prompt helper
  const restorePrompt = async (): Promise<{ source: string } | null> => {
    const currentFile = opfs.files.get('project/autosave/current.json')
    if (!currentFile) return null
    return { source: 'current' }
  }

  return { initAutoSave, opfs, collectorEvents, runnerTelemetry, guardSnapshots, restorePrompt }
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