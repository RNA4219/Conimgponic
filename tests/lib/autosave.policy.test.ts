import { test } from 'node:test'; import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'; import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'; import { createRequire } from 'node:module'
import vm from 'node:vm'; import ts from 'typescript'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const req = createRequire(import.meta.url)
const cache = new Map<string, vm.SourceTextModule>()

const createOpfsMock = () => {
  const files = new Map<string, string>()
  const dirs = new Map<string, any>()
  const makeDir = (prefix: string): any => {
    if (dirs.has(prefix)) return dirs.get(prefix)
    const dir = {
      async getDirectoryHandle(name: string) {
        return makeDir(join(prefix, name))
      },
      async getFileHandle(name: string) {
        const full = join(prefix, name).replace(/^\/+/, '')
        return {
          async createWritable() {
            return {
              async write(data: string) {
                files.set(full, data)
              },
              async close() {}
            }
          },
          async getFile() {
            if (!files.has(full)) throw new Error('missing file')
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
  return { files, storage: { async getDirectory() { return makeDir('') } } }
}
const withExt = (spec: string) => {
  if (spec.startsWith('node:')) return spec
  if (spec.endsWith('.ts')) return spec
  if (spec.endsWith('.js')) return `${spec.slice(0, -3)}.ts`
  return `${spec}.ts`
}
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

test('createVscodeAutoSaveBridge shares AUTOSAVE-DESIGN-IMPL Phase A defaults', async () => {
  cache.clear()
  const { resolveAutoSaveBootstrapPlan } = await importTs(join(root, 'src/config/index.ts'))
  const { createVscodeAutoSaveBridge } = await importTs(join(root, 'src/platform/vscode/autosave.ts'))
  const { AUTOSAVE_POLICY } = await importTs(join(root, 'src/lib/autosave.ts'))

  const workspace = {
    get(key: string): unknown {
      switch (key) {
        case 'conimg.autosave.enabled':
          return true
        case 'conimg.autosave.historyLimit':
          return 2
        case 'conimg.autosave.sizeLimitMB':
          return 5
        default:
          return undefined
      }
    }
  }

  const plan = resolveAutoSaveBootstrapPlan({ workspace, clock: () => new Date('2024-01-01T00:00:00.000Z') })
  assert.equal(plan.policy, AUTOSAVE_POLICY)
  assert.equal(plan.policy.maxGenerations, AUTOSAVE_POLICY.maxGenerations)
  assert.equal(plan.policy.maxBytes, AUTOSAVE_POLICY.maxBytes)

  const sent: any[] = []
  let tick = 0
  const bridge = createVscodeAutoSaveBridge({
    policy: plan.policy,
    initialGuard: plan.guard,
    flags: plan.snapshot,
    now: () => {
      const base = new Date('2024-01-01T00:00:00.000Z')
      base.setSeconds(base.getSeconds() + tick)
      tick += 1
      return base
    },
    sendMessage: (message: any) => { sent.push(message) },
    atomicWrite: async () => {
      const generation = sent.filter((msg) => msg?.type === 'snapshot.result').length + 1
      return {
        ok: true as const,
        bytes: 2 * 1024 * 1024,
        generation,
        lastSuccessAt: new Date('2024-01-01T00:00:10.000Z').toISOString(),
        lockStrategy: 'web-lock' as const
      }
    }
  })

  for (let i = 0; i < 3; i += 1) {
    bridge.reportDirty(2 * 1024 * 1024, plan.guard)
    await bridge.handleSnapshotRequest({
      type: 'snapshot.request',
      apiVersion: 1,
      phase: 'A-2',
      bridgePhase: 'snapshot.request',
      reqId: `req-${i}`,
      correlationId: `corr-${i}`,
      ts: new Date('2024-01-01T00:00:00.000Z').toISOString(),
      payload: {
        reason: 'change',
        storyboard: { id: 'sb', title: 'Story', scenes: [], selection: [], version: 1 },
        pendingBytes: 2 * 1024 * 1024,
        queuedGeneration: i,
        debounceMs: plan.policy.debounceMs,
        idleMs: plan.policy.idleMs,
        historyLimit: plan.policy.maxGenerations,
        sizeLimit: plan.policy.maxBytes,
        guard: plan.guard
      }
    })
  }

  const history = bridge.inspectHistory()
  assert.equal(history.generations, 3)
  assert.ok(history.generations <= AUTOSAVE_POLICY.maxGenerations)
  assert.ok(history.retainedBytes <= AUTOSAVE_POLICY.maxBytes)

  const results = sent.filter((msg) => msg?.type === 'snapshot.result')
  assert.equal(results.length, 3)
  const last = results[results.length - 1]
  assert.equal(last.payload.retainedBytes, history.retainedBytes)
})

test('resolveAutoSavePolicy keeps Phase A fixed limits (docs/AUTOSAVE-DESIGN-IMPL.md §1.1, docs/MERGE-DESIGN-IMPL.md §0.4)', async () => {
  cache.clear()
  const { resolveAutoSaveBootstrapPlan } = await importTs(join(root, 'src/config/index.ts'))
  const { initAutoSave, resolveAutoSavePolicy, AUTOSAVE_POLICY } = await importTs(
    join(root, 'src/lib/autosave.ts')
  )

  const originalHistory = process.env.VITE_AUTOSAVE_HISTORY_LIMIT
  const originalSize = process.env.VITE_AUTOSAVE_SIZE_LIMIT_MB

  try {
    process.env.VITE_AUTOSAVE_HISTORY_LIMIT = '30'
    process.env.VITE_AUTOSAVE_SIZE_LIMIT_MB = '100'

    const plan = resolveAutoSaveBootstrapPlan({ workspace: null })
    assert.equal(plan.policy, AUTOSAVE_POLICY)
    assert.equal(plan.policy.maxGenerations, 20)
    assert.equal(plan.policy.maxBytes, 50 * 1024 * 1024)

    const envPolicy = resolveAutoSavePolicy()
    assert.equal(envPolicy, AUTOSAVE_POLICY)
    assert.equal(envPolicy.maxGenerations, 20)
    assert.equal(envPolicy.maxBytes, 50 * 1024 * 1024)

    const workspace = {
      get(key: string): unknown {
        switch (key) {
          case 'conimg.autosave.historyLimit':
            return 35
          case 'conimg.autosave.sizeLimitMB':
            return 120
          default:
            return undefined
        }
      }
    }

    const workspacePolicyPlan = resolveAutoSaveBootstrapPlan({ workspace })
    assert.equal(workspacePolicyPlan.policy, AUTOSAVE_POLICY)
    assert.equal(workspacePolicyPlan.policy.maxGenerations, 20)
    assert.equal(workspacePolicyPlan.policy.maxBytes, 50 * 1024 * 1024)

    const workspacePolicy = resolveAutoSavePolicy(workspace)
    assert.equal(workspacePolicy, AUTOSAVE_POLICY)
    assert.equal(workspacePolicy.maxGenerations, 20)
    assert.equal(workspacePolicy.maxBytes, 50 * 1024 * 1024)

    const opfs = createOpfsMock()
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: opfs.storage,
        locks: {
          async request(_name: string, cb: (lock: { release(): Promise<void> }) => unknown) {
            return cb({ async release() {} })
          }
        }
      },
      configurable: true
    })

    const payloads = ['a'.repeat(450_000), 'b'.repeat(450_000), 'c'.repeat(450_000)]
    let flushCount = 0
    const runner = initAutoSave(() => {
      const index = Math.min(flushCount, payloads.length - 1)
      const manual = payloads[index]
      flushCount += 1
      return {
        id: 'storyboard',
        title: `Storyboard-${index}`,
        scenes: [
          { id: `scene-${index}`, manual, ai: '', status: 'idle', assets: [] }
        ],
        selection: [],
        version: 1
      }
    }, { disabled: false })

    await runner.flushNow()
    await runner.flushNow()
    await runner.flushNow()

    const historyKeys = Array.from(opfs.files.keys()).filter((key) =>
      key.startsWith('project/autosave/history/')
    )
    assert.ok(historyKeys.length <= AUTOSAVE_POLICY.maxGenerations)
    const totalBytes = historyKeys.reduce((sum, key) => {
      const content = opfs.files.get(key) ?? ''
      return sum + Buffer.byteLength(content, 'utf8')
    }, 0)
    assert.ok(totalBytes <= AUTOSAVE_POLICY.maxBytes)

    await runner.dispose()
  } finally {
    if (originalHistory == null) {
      delete process.env.VITE_AUTOSAVE_HISTORY_LIMIT
    } else {
      process.env.VITE_AUTOSAVE_HISTORY_LIMIT = originalHistory
    }
    if (originalSize == null) {
      delete process.env.VITE_AUTOSAVE_SIZE_LIMIT_MB
    } else {
      process.env.VITE_AUTOSAVE_SIZE_LIMIT_MB = originalSize
    }
    delete (globalThis as { navigator?: unknown }).navigator
  }
})
