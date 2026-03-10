import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  AutoSavePhaseGuardSnapshot,
  AutoSaveInitResult
} from '../../src/lib/autosave'
import type { FlagSnapshot } from '../../src/config/flags'
import { setup as createAutoSaveTestSetup } from './autosave/setup'

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)))

// Correct FlagSnapshot creator matching the actual type structure
const createFlags = (enabled: boolean): FlagSnapshot => ({
  autosave: {
    value: enabled,
    source: enabled ? 'env' : 'default',
    errors: []
  },
  plugins: {
    value: false,
    source: 'default',
    errors: []
  },
  merge: {
    value: 'legacy',
    source: 'default',
    errors: []
  },
  updatedAt: new Date().toISOString()
})

interface SetupResult {
  initAutoSave: (typeof import('../../src/lib/autosave'))['initAutoSave']
  resolveAutoSaveGuard: (typeof import('../../src/lib/autosave/guard'))['resolveAutoSaveGuard']
  opfs: { files: Map<string, string> }
}

const setup = async (t: TestContext, overrides: {
  locks?: { request?: (...args: unknown[]) => Promise<unknown> }
  opfs?: { beforeWrite?: (path: string) => void }
} = {}): Promise<SetupResult> => {
  // Create OPFS mock
  const files = new Map<string, string>()
  const dirs = new Map<string, { getDirectoryHandle: (name: string) => Promise<unknown>; getFileHandle: (name: string) => Promise<unknown>; removeEntry: (name: string) => Promise<void>; entries: () => AsyncGenerator<readonly [string, Record<string, never>], void, unknown> }>()
  const makeDir = (prefix: string) => {
    if (dirs.has(prefix)) return dirs.get(prefix)!
    const dir = {
      async getDirectoryHandle(name: string) { return makeDir(join(prefix, name)) },
      async getFileHandle(name: string) {
        const full = join(prefix, name).replace(/^\/+/, '')
        return {
          async createWritable() {
            return {
              async write(data: string) {
                overrides.opfs?.beforeWrite?.(full)
                files.set(full, data)
              },
              async close() {}
            }
          },
          async getFile() {
            if (!files.has(full)) {
              const error = new Error('missing file')
              error.name = 'NotFoundError'
              throw error
            }
            const text = files.get(full)!
            return { async text() { return text } }
          }
        }
      },
      async removeEntry(name: string) {
        files.delete(join(prefix, name).replace(/^\/+/, ''))
      },
      async *entries() {
        const seen = new Set<string>()
        for (const key of files.keys()) {
          if (!key.startsWith(prefix)) continue
          const head = key.slice(prefix.length).replace(/^\//, '').split('/')[0]
          if (head && !seen.has(head)) {
            seen.add(head)
            yield [head, {}] as const
          }
        }
      }
    }
    dirs.set(prefix, dir)
    return dir
  }

  const opfs = { files, storage: { async getDirectory() { return makeDir('') } } }

  // Setup navigator mock
  const navigatorValue = {
    storage: opfs.storage,
    locks: {
      async request(_name: string, callback: (lock: { release: () => Promise<void> }) => Promise<unknown>) {
        return callback({ async release() {} })
      },
      ...overrides.locks
    }
  }
  Object.defineProperty(globalThis, 'navigator', { value: navigatorValue, configurable: true })
  t.after(() => {
    delete (globalThis as { navigator?: unknown }).navigator
  })

  // Dynamically import the modules
  const autosaveModule = await import('../../src/lib/autosave.js')
  const guardModule = await import('../../src/lib/autosave/guard.js')

  const runners: AutoSaveInitResult[] = []
  t.after(async () => {
    const pending = runners.splice(0)
    await Promise.all(pending.map(r => r.dispose()))
  })

  const initAutoSave: typeof autosaveModule.initAutoSave = (...args) => {
    const runner = autosaveModule.initAutoSave(...args)
    runners.push(runner)
    return runner
  }

  return {
    initAutoSave,
    resolveAutoSaveGuard: guardModule.resolveAutoSaveGuard,
    opfs
  }
}

const scenario = (
  name: string,
  overridesOrFn: Parameters<typeof setup>[1] | ((t: TestContext, ctx: SetupResult) => Promise<void>),
  fnOrNone?: (t: TestContext, ctx: SetupResult) => Promise<void>
) => {
  test(name, async (t) => {
    const actualFn = typeof overridesOrFn === 'function' ? overridesOrFn : fnOrNone!
    const actualOverrides = typeof overridesOrFn === 'function' ? {} : overridesOrFn
    const ctx = await setup(t, actualOverrides)
    await actualFn(t, ctx)
  })
}

scenario('resolveAutoSaveGuard returns allowed: true when flagSnapshot.autosave.value is true', async (_t, { resolveAutoSaveGuard }) => {
  const flagSnapshot: FlagSnapshot = {
    autosave: { value: true, source: 'env', errors: [] },
    plugins: { value: false, source: 'default', errors: [] },
    merge: { value: 'legacy', source: 'default', errors: [] },
    updatedAt: new Date().toISOString()
  }
  const { allowed, guard } = resolveAutoSaveGuard({ flagSnapshot })
  assert.equal(allowed, true)
  assert.equal(guard.featureFlag.value, true)
  assert.equal(guard.featureFlag.source, 'env')
  assert.equal(guard.optionsDisabled, false)
})

scenario('resolveAutoSaveGuard returns allowed: false when flagSnapshot.autosave.value is false', async (_t, { resolveAutoSaveGuard }) => {
  const flagSnapshot: FlagSnapshot = {
    autosave: { value: false, source: 'env', errors: [] },
    plugins: { value: false, source: 'default', errors: [] },
    merge: { value: 'legacy', source: 'default', errors: [] },
    updatedAt: new Date().toISOString()
  }
  const { allowed, guard } = resolveAutoSaveGuard({ flagSnapshot })
  assert.equal(allowed, false)
  assert.equal(guard.featureFlag.value, false)
  assert.equal(guard.featureFlag.source, 'env')
  assert.equal(guard.optionsDisabled, false)
})

scenario('resolveAutoSaveGuard returns allowed: false when flagSnapshot is not provided and fallbackOptionsDisabled is true', async (_t, { resolveAutoSaveGuard }) => {
  const { allowed, guard } = resolveAutoSaveGuard({ fallbackOptionsDisabled: true })
  assert.equal(allowed, false)
  assert.equal(guard.featureFlag.value, true)
  assert.equal(guard.featureFlag.source, 'default')
  assert.equal(guard.optionsDisabled, true)
})

scenario('resolveAutoSaveGuard returns allowed: true when flagSnapshot is not provided and fallbackOptionsDisabled is false', async (_t, { resolveAutoSaveGuard }) => {
  const { allowed, guard } = resolveAutoSaveGuard({ fallbackOptionsDisabled: false })
  assert.equal(allowed, true)
  assert.equal(guard.featureFlag.value, true)
  assert.equal(guard.featureFlag.source, 'default')
  assert.equal(guard.optionsDisabled, false)
})

scenario('resolveAutoSaveGuard returns allowed: false when flagSnapshot has errors', async (_t, { resolveAutoSaveGuard }) => {
  const flagSnapshot: FlagSnapshot = {
    autosave: {
      value: true,
      source: 'env',
      errors: [{ code: 'invalid-boolean', flag: 'autosave.enabled', raw: 'invalid', message: 'Invalid boolean', retryable: false, phase: 'phase-a0', source: 'env' }]
    },
    plugins: { value: false, source: 'default', errors: [] },
    merge: { value: 'legacy', source: 'default', errors: [] },
    updatedAt: new Date().toISOString()
  }
  const { allowed, guard } = resolveAutoSaveGuard({ flagSnapshot })
  assert.equal(allowed, false)
  assert.equal(guard.featureFlag.value, true)
  assert.equal(guard.featureFlag.source, 'env')
  assert.equal(guard.optionsDisabled, true)
})

scenario('phase guard stops runner when flag disabled', async (_t, { initAutoSave }) => {
  const flags = createFlags(false)
  const runner = initAutoSave(() => ({ nodes: [] }) as any, { disabled: false }, flags)
  assert.equal(runner.snapshot().phase, 'disabled')
  await assert.doesNotReject(() => runner.flushNow())
  assert.doesNotThrow(() => runner.dispose())
  assert.equal(runner.snapshot().phase, 'disabled')
})

scenario(
  'flushNow resolves without error when disabled by workspace flag snapshot',
  async (_t, { initAutoSave }) => {
    const flags = createFlags(false)
    const workspaceFlag = {
      ...flags,
      autosave: {
        ...flags.autosave,
        value: false,
        source: 'workspace'
      }
    }
    const runner = initAutoSave(() => ({ nodes: [] }) as any, { disabled: false }, workspaceFlag)
    assert.equal(runner.snapshot().phase, 'disabled')
    await assert.doesNotReject(async () => runner.flushNow())
    assert.equal(runner.snapshot().phase, 'disabled')
    assert.doesNotThrow(() => runner.dispose())
  }
)

scenario(
  'flushNow resolves without error when options disable autosave',
  async (_t, { initAutoSave }) => {
    const flags = createFlags(true)
    const runner = initAutoSave(() => ({ nodes: [] }) as any, { disabled: true }, flags)
    assert.equal(runner.snapshot().phase, 'disabled')
    await assert.doesNotReject(async () => runner.flushNow())
    assert.equal(runner.snapshot().phase, 'disabled')
    assert.doesNotThrow(() => runner.dispose())
  }
)

scenario(
  'phase guard emits autosave.guard telemetry when collector available',
  async (t, { initAutoSave }) => {
    const events: Record<string, unknown>[] = []
    Object.defineProperty(globalThis, 'Day8Collector', {
      value: { publish: (event: Record<string, unknown>) => { events.push(event) } },
      configurable: true
    })
    t.after(() => delete (globalThis as { Day8Collector?: unknown }).Day8Collector)

    const flags = createFlags(false)
    initAutoSave(() => ({ nodes: [] }) as any, { disabled: false }, flags)

    assert.equal(events.length, 1)
    const event = events[0]
    assert.equal(event.feature, 'autosave-diff-merge')
    assert.equal(event.event, 'autosave.guard')
    assert.equal(event.blocked, true)
    assert.equal(event.reason, 'feature-flag-disabled')
    assert.equal(event.phase, 'disabled')
    assert.equal(event.level, 'debug')
    assert.deepEqual(event.guard, {
      featureFlag: { value: false, source: 'default' },
      optionsDisabled: false
    })
    assert.match(String(event.ts ?? ''), /^\d{4}-\d{2}-\d{2}T/)
  }
)

scenario(
  'bootstrap snapshot source propagates through initAutoSave fallback guard',
  async (t, { initAutoSave }) => {
    const storage = new Map<string, string>([['autosave.enabled', '0']])
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem(key: string) { return storage.get(key) ?? null }
      },
      configurable: true
    })
    const { resolveAutoSaveBootstrapPlan } = await import('../../src/config/index.js')
    const plan = resolveAutoSaveBootstrapPlan()

    const events: Record<string, unknown>[] = []
    Object.defineProperty(globalThis, 'Day8Collector', {
      value: { publish(event: Record<string, unknown>) { events.push(event) } },
      configurable: true
    })

    t.after(() => {
      delete (globalThis as { localStorage?: unknown }).localStorage
      delete (globalThis as { Day8Collector?: unknown }).Day8Collector
    })

    const runner = initAutoSave(() => ({ nodes: [] }) as any, { disabled: false })

    assert.equal(runner.snapshot().phase, 'disabled')
    assert.equal(events.length, 1)
    const event = events[0] as { guard?: { featureFlag?: { value?: boolean; source?: string }; optionsDisabled?: boolean } }
    assert.deepEqual(event.guard, plan.guard)
    assert.equal(plan.guard.featureFlag.source, plan.snapshot.autosave.source)
    assert.equal(plan.guard.featureFlag.value, plan.snapshot.autosave.value)
    assert.doesNotThrow(() => runner.dispose())
  }
)

scenario(
  'fallback guard prefers workspace configuration over localStorage',
  async (t, { initAutoSave }) => {
    const storage = new Map<string, string>([['autosave.enabled', '1']])
    const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem(key: string) { return storage.get(key) ?? null }
      },
      configurable: true
    })
    const workspace = {
      get(key: string) { return key === 'autosave.enabled' ? false : undefined }
    }
    const originalWorkspace = Object.getOwnPropertyDescriptor(globalThis, '__AUTOSAVE_WORKSPACE__')
    Object.defineProperty(globalThis, '__AUTOSAVE_WORKSPACE__', {
      value: workspace,
      configurable: true
    })
    const events: Record<string, unknown>[] = []
    const originalCollector = Object.getOwnPropertyDescriptor(globalThis, 'Day8Collector')
    Object.defineProperty(globalThis, 'Day8Collector', {
      value: { publish(event: Record<string, unknown>) { events.push(event) } },
      configurable: true
    })

    t.after(() => {
      if (originalLocalStorage) {
        Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
      } else {
        delete (globalThis as { localStorage?: unknown }).localStorage
      }
      if (originalWorkspace) {
        Object.defineProperty(globalThis, '__AUTOSAVE_WORKSPACE__', originalWorkspace)
      } else {
        delete (globalThis as { __AUTOSAVE_WORKSPACE__?: unknown }).__AUTOSAVE_WORKSPACE__
      }
      if (originalCollector) {
        Object.defineProperty(globalThis, 'Day8Collector', originalCollector)
      } else {
        delete (globalThis as { Day8Collector?: unknown }).Day8Collector
      }
    })

    const runner = initAutoSave(() => ({ nodes: [] }) as any, { disabled: false })

    assert.equal(runner.snapshot().phase, 'disabled')
    assert.equal(events.length, 1)
    const guard = events[0]?.guard as { featureFlag?: { value?: boolean; source?: string } }
    assert.equal(guard?.featureFlag?.source, 'workspace')
    assert.equal(guard?.featureFlag?.value, false)
    assert.doesNotThrow(() => runner.dispose())
  }
)

scenario(
  'fallback guard reads VS Code configuration scoped by conimg prefix',
  async (t, { initAutoSave }) => {
    const storage = new Map<string, string>([['autosave.enabled', '1']])
    const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem(key: string) { return storage.get(key) ?? null }
      },
      configurable: true
    })
    const workspaceConfig = {
      get(key: string) {
        if (key !== 'autosave.enabled') return undefined
        return 'false'
      }
    }
    const vscode = {
      workspace: {
        getConfiguration(section: string) {
          if (section !== 'conimg') throw new Error('unexpected section')
          return workspaceConfig
        }
      }
    }
    const originalVscode = Object.getOwnPropertyDescriptor(globalThis, 'vscode')
    Object.defineProperty(globalThis, 'vscode', { value: vscode, configurable: true })
    const originalWorkspace = Object.getOwnPropertyDescriptor(globalThis, '__AUTOSAVE_WORKSPACE__')
    Object.defineProperty(globalThis, '__AUTOSAVE_WORKSPACE__', {
      value: vscode.workspace.getConfiguration('conimg'),
      configurable: true
    })
    const events: Record<string, unknown>[] = []
    const originalCollector = Object.getOwnPropertyDescriptor(globalThis, 'Day8Collector')
    Object.defineProperty(globalThis, 'Day8Collector', {
      value: { publish(event: Record<string, unknown>) { events.push(event) } },
      configurable: true
    })

    t.after(() => {
      if (originalLocalStorage) {
        Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
      } else {
        delete (globalThis as { localStorage?: unknown }).localStorage
      }
      if (originalWorkspace) {
        Object.defineProperty(globalThis, '__AUTOSAVE_WORKSPACE__', originalWorkspace)
      } else {
        delete (globalThis as { __AUTOSAVE_WORKSPACE__?: unknown }).__AUTOSAVE_WORKSPACE__
      }
      if (originalVscode) {
        Object.defineProperty(globalThis, 'vscode', originalVscode)
      } else {
        delete (globalThis as { vscode?: unknown }).vscode
      }
      if (originalCollector) {
        Object.defineProperty(globalThis, 'Day8Collector', originalCollector)
      } else {
        delete (globalThis as { Day8Collector?: unknown }).Day8Collector
      }
    })

    const runner = initAutoSave(() => ({ nodes: [] }) as any, { disabled: false })

    assert.equal(runner.snapshot().phase, 'disabled')
    assert.equal(events.length, 1)
    const guard = events[0]?.guard as { featureFlag?: { value?: boolean; source?: string } }
    assert.equal(guard?.featureFlag?.source, 'workspace')
    assert.equal(guard?.featureFlag?.value, false)
    assert.doesNotThrow(() => runner.dispose())
  }
)

test(
  'fallback guard enables autosave when import.meta env flag set',
  async (t) => {
    const { initAutoSave } = await createAutoSaveTestSetup(t, {
      importMetaEnv: { VITE_AUTOSAVE_ENABLED: 'true' }
    })
    const scope = globalThis as typeof globalThis & {
      __AUTOSAVE_ENABLED__?: boolean
      process?: { env?: Record<string, unknown> }
    }
    const hadRuntimeFlag = Object.prototype.hasOwnProperty.call(scope, '__AUTOSAVE_ENABLED__')
    const previousRuntimeFlag = scope.__AUTOSAVE_ENABLED__
    delete scope.__AUTOSAVE_ENABLED__
    t.after(() => {
      if (hadRuntimeFlag) {
        scope.__AUTOSAVE_ENABLED__ = previousRuntimeFlag!
      } else {
        delete scope.__AUTOSAVE_ENABLED__
      }
    })
    const processEnv = scope.process?.env as Record<string, unknown> | undefined
    const hadProcessFlag =
      processEnv != null && Object.prototype.hasOwnProperty.call(processEnv, 'VITE_AUTOSAVE_ENABLED')
    const previousProcessFlag = hadProcessFlag ? processEnv!.VITE_AUTOSAVE_ENABLED : undefined
    if (processEnv) {
      delete processEnv.VITE_AUTOSAVE_ENABLED
    }
    t.after(() => {
      if (!processEnv) return
      if (hadProcessFlag) {
        processEnv.VITE_AUTOSAVE_ENABLED = previousProcessFlag
      } else {
        delete processEnv.VITE_AUTOSAVE_ENABLED
      }
    })

    const runner = initAutoSave(() => ({ nodes: [] }) as any, { disabled: false })

    assert.equal(runner.snapshot().phase, 'idle')
    await assert.doesNotReject(async () => runner.dispose())
  }
)

scenario(
  'workspace source takes precedence over global overrides',
  async (t, { initAutoSave }) => {
    const flags = createFlags(false)
    const workspaceFlag = {
      ...flags,
      autosave: {
        ...flags.autosave,
        value: false,
        source: 'workspace'
      }
    }
    Object.defineProperty(globalThis, '__AUTOSAVE_ENABLED__', { value: true, configurable: true })
    t.after(() => delete (globalThis as { __AUTOSAVE_ENABLED__?: unknown }).__AUTOSAVE_ENABLED__)
    const runner = initAutoSave(() => ({ nodes: [] }) as any, { disabled: false }, workspaceFlag)
    assert.equal(runner.snapshot().phase, 'disabled')
    await assert.doesNotReject(async () => runner.flushNow())
    assert.equal(runner.snapshot().phase, 'disabled')
    assert.doesNotThrow(() => runner.dispose())
  }
)

scenario(
  'phase guard no-ops flush and dispose when disabled by flag and options',
  async (_t, { initAutoSave }) => {
    const flags = createFlags(false)
    const runner = initAutoSave(() => ({ nodes: [] }) as any, { disabled: true }, flags)
    assert.equal(runner.snapshot().phase, 'disabled')
    await assert.doesNotReject(() => runner.flushNow())
    assert.doesNotThrow(() => runner.dispose())
    assert.equal(runner.snapshot().phase, 'disabled')
  }
)

scenario(
  'disabled flushNow returns shared resolved promise',
  async (_t, { initAutoSave }) => {
    const flags = createFlags(false)
    const runner = initAutoSave(() => ({ nodes: [] }) as any, { disabled: false }, flags)
    const first = runner.flushNow()
    const second = runner.flushNow()
    assert.strictEqual(first, second)
    assert.equal(await first, undefined)
  }
)

scenario('phase guard returns to idle when re-enabled', async (_t, { initAutoSave }) => {
  const disabledGuard: AutoSavePhaseGuardSnapshot = {
    featureFlag: { value: false, source: 'env' },
    optionsDisabled: true
  }
  const disabledRunner = initAutoSave(() => ({ nodes: [] }) as any, { disabled: true }, disabledGuard)
  assert.equal(disabledRunner.snapshot().phase, 'disabled')

  const enabledGuard: AutoSavePhaseGuardSnapshot = {
    featureFlag: { value: true, source: 'env' },
    optionsDisabled: false
  }
  const enabledRunner = initAutoSave(() => ({ nodes: [] }) as any, { disabled: false }, enabledGuard)
  assert.equal(enabledRunner.snapshot().phase, 'idle')
})

scenario('phase guard keeps dirty snapshot when enabled and generation queued', async (_t, { initAutoSave }) => {
  const flags = createFlags(true)
  const runner = initAutoSave(() => ({ nodes: [{ id: 'a' }] }) as any, { disabled: false }, flags)
  runner.markDirty({ reason: 'test' })
  assert.equal(runner.snapshot().phase, 'debouncing')
  assert.equal(runner.snapshot().retryCount, 0)
})

scenario(
  'phase guard marks dirty when AutoSavePhaseGuardSnapshot is provided directly',
  async (_t, { initAutoSave }) => {
    const guard: AutoSavePhaseGuardSnapshot = {
      featureFlag: { value: true, source: 'workspace' },
      optionsDisabled: false
    }
    const runner = initAutoSave(() => ({ nodes: [{ id: 'guard-direct' }] }) as any, { disabled: false }, guard)
    runner.markDirty()
    assert.equal(runner.snapshot().phase, 'debouncing')
  }
)

scenario('phase guard treats guard snapshot as phase-a when feature flag enabled', async (_t, { initAutoSave }) => {
  const guard: AutoSavePhaseGuardSnapshot = {
    featureFlag: { value: true, source: 'env' },
    optionsDisabled: false
  }
  const runner = initAutoSave(() => ({ nodes: [{ id: 'guarded' }] }) as any, { disabled: false }, guard)
  runner.markDirty({ reason: 'direct-guard' })
  assert.equal(runner.snapshot().phase, 'debouncing')
})

scenario('saving phase holds lock before history write', async (_t, { initAutoSave }) => {
  const flags = createFlags(true)
  const runner = initAutoSave(() => ({ nodes: [] }) as any, { disabled: false }, flags)
  await runner.flushNow()
  assert.equal(runner.snapshot().phase, 'idle')
  assert.ok(runner.snapshot().lastSuccessAt)
})

scenario(
  'backoff phase surfaces retryable error when Web Lock fails and .lock fallback pending',
  {
    locks: {
      async request() { throw new Error('denied') }
    },
    opfs: {
      beforeWrite(path) {
        if (path === 'project/.lock') throw new Error('fallback-busy')
      }
    }
  },
  async (_t, { initAutoSave }) => {
    const flags = createFlags(true)
    const runner = initAutoSave(() => ({ nodes: [] }) as any, { disabled: false }, flags)
    let error: unknown
    try {
      await runner.flushNow()
      assert.fail('expected flushNow to reject')
    } catch (caught) {
      error = caught
    }
    assert.ok(error && typeof error === 'object')
    assert.equal((error as { code?: string })?.code, 'lock-unavailable')
    assert.equal((error as { retryable?: boolean })?.retryable, true)
    assert.equal(runner.snapshot().phase, 'backoff')
    assert.equal(runner.snapshot().lastError?.code, 'lock-unavailable')
  }
)

scenario('history fifo surfaces retained entries via listHistory metadata', async (_t, { initAutoSave }) => {
  const flags = createFlags(true)
  const runner = initAutoSave(() => ({ nodes: [{ id: 'unit' }] }) as any, { disabled: false }, flags)
  for (let i = 0; i < 24; i++) {
    runner.markDirty({ pendingBytes: 32 })
    await runner.flushNow()
  }
  const { listHistory } = await import('../../src/lib/autosave.js')
  const history = await listHistory()
  assert.ok(history.length <= 20)
  assert.ok(history.every((entry) => entry.location === 'history' && entry.retained))
  for (let i = 1; i < history.length; i++) {
    assert.ok(history[i - 1].ts <= history[i].ts)
  }
})

scenario(
  'write failure transitions runner to error phase with retryable AutoSaveError',
  {
    opfs: {
      beforeWrite(path) {
        if (path.endsWith('current.json.tmp')) throw new Error('disk-full')
      }
    }
  },
  async (_t, { initAutoSave }) => {
    const flags = createFlags(true)
    const runner = initAutoSave(() => ({ nodes: [{ id: 'x' }] }) as any, { disabled: false }, flags)
    await assert.rejects(
      runner.flushNow(),
      (error: unknown) =>
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === 'write-failed' &&
        'retryable' in error &&
        (error as { retryable: boolean }).retryable === true
    )
    const snap = runner.snapshot()
    assert.equal(snap.phase, 'backoff')
    assert.equal(snap.lastError?.code, 'write-failed')
    assert.ok(snap.retryCount >= 1)
  }
)

scenario(
  'non-retryable history overflow downgrades snapshot to disabled',
  {
    opfs: {
      beforeWrite(path) {
        if (path.endsWith('index.json.tmp')) {
          const error = Object.assign(new Error('history overflow'), {
            code: 'history-overflow',
            retryable: false
          })
          throw error
        }
      }
    }
  },
  async (_t, { initAutoSave }) => {
    const flags = createFlags(true)
    const runner = initAutoSave(() => ({ nodes: [{ id: 'overflow' }] }) as any, { disabled: false }, flags)
    let error: unknown
    try {
      await runner.flushNow()
      assert.fail('expected flushNow to reject')
    } catch (caught) {
      error = caught
    }
    assert.ok(error && typeof error === 'object')
    assert.equal((error as { code?: string })?.code, 'history-overflow')
    assert.equal((error as { retryable?: boolean })?.retryable, false)
    const snap = runner.snapshot()
    assert.equal(snap.phase, 'disabled')
    assert.equal(snap.lastError?.code, 'history-overflow')
    assert.equal(snap.retryCount, 0)
  }
)