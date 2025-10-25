import { test } from 'node:test'; import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'; import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'; import { createRequire } from 'node:module'
import vm from 'node:vm'; import ts from 'typescript'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const req = createRequire(import.meta.url)
const cache = new Map<string, vm.SourceTextModule>()
const withExt = (spec: string) => {
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

test('workspace autosave policy overrides history GC constraints', async () => {
  cache.clear()
  const { resolveAutoSaveBootstrapPlan } = await importTs(join(root, 'src/config/index.ts'))
  const { createVscodeAutoSaveBridge } = await importTs(join(root, 'src/platform/vscode/autosave.ts'))

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
  assert.equal(plan.policy.maxGenerations, 2)
  assert.equal(plan.policy.maxBytes, 5 * 1024 * 1024)

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
  assert.equal(history.generations, 2)
  assert.ok(history.retainedBytes <= plan.policy.maxBytes)

  const results = sent.filter((msg) => msg?.type === 'snapshot.result')
  assert.equal(results.length, 3)
  const last = results[results.length - 1]
  assert.equal(last.payload.retainedBytes, history.retainedBytes)
})
