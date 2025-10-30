import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'

import {
  ENABLED_GUARD,
  createLocalStorageStub,
  type LocalStorageStub,
  scenario
} from './setup'

import type { AutoSaveError } from '../../../src/lib/autosave'
import type { Storyboard } from '../../../src/types'

const makeStoryboard = (nodes: string[]): Storyboard => ({
  id: 'storyboard',
  title: 'Storyboard',
  scenes: nodes.map((id) => ({
    id,
    manual: '',
    ai: '',
    status: 'idle',
    assets: []
  })),
  selection: [],
  version: 1
})

const isAutoSaveError = (
  expected: { code: AutoSaveError['code']; retryable: AutoSaveError['retryable'] }
) =>
  (error: unknown): error is AutoSaveError => {
    if (!error || typeof error !== 'object') return false
    const candidate = error as AutoSaveError
    return candidate.code === expected.code && candidate.retryable === expected.retryable
  }

scenario('flushNow persists storyboard and restorePrompt exposes metadata', async (_t, { initAutoSave, restorePrompt, opfs }) => {
  const runner = initAutoSave(() => makeStoryboard(['hero']), { disabled: false }, ENABLED_GUARD)
  await runner.flushNow()
  const meta = await restorePrompt()
  assert.equal(runner.snapshot().phase, 'idle')
  assert.ok(opfs.files.has('project/autosave/current.json'))
  assert.ok(opfs.files.has('project/autosave/index.json'))
  assert.ok(!opfs.files.has('project/autosave/current.json.tmp'))
  assert.ok(!opfs.files.has('project/autosave/index.json.tmp'))
  assert.ok(Array.from(opfs.files.keys()).some((key) => key.startsWith('project/autosave/history/')))
  const indexRaw = opfs.files.get('project/autosave/index.json')
  assert.ok(typeof indexRaw === 'string')
  const index = JSON.parse(indexRaw) as { entries?: unknown }
  assert.ok(Array.isArray(index.entries))
  assert.equal(runner.snapshot().retryCount, 0)
  assert.equal(runner.snapshot().pendingBytes, 0)
  assert.ok(typeof runner.snapshot().lastSuccessAt === 'string')
  for (const key of opfs.files.keys()) assert.ok(!key.endsWith('.tmp'))
  assert.equal(meta?.source, 'current')
})

scenario('history rotation keeps at most 20 generations', async (_t, { initAutoSave, opfs }) => {
  const runner = initAutoSave(() => makeStoryboard([]), { disabled: false }, ENABLED_GUARD)
  for (let i = 0; i < 22; i++) await runner.flushNow()
  const historyCount = Array.from(opfs.files.keys()).filter((k) => k.startsWith('project/autosave/history/')).length
  assert.ok(historyCount <= 20)
})

scenario(
  'import.meta env enables guard resolution from environment',
  { importMetaEnv: { VITE_AUTOSAVE_ENABLED: 'true' } },
  async (t: TestContext, { initAutoSave, runnerTelemetry }) => {
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

    const runner = initAutoSave(() => makeStoryboard(['import-meta-env']), { disabled: false })
    assert.notEqual(runner.snapshot().phase, 'disabled')
    runner.markDirty({ pendingBytes: 1024 })
    const telemetry = runnerTelemetry.filter(
      (event) => event.detail?.event === 'autosave.schedule.requested'
    )
    assert.ok(telemetry.length > 0)
    const last = telemetry.at(-1)!
    assert.equal(last.detail?.flag_source, 'env')
  }
)

scenario(
  'legacy localStorage key enables guard resolution from storage',
  async (t: TestContext, { initAutoSave, runnerTelemetry }) => {
    const storage = createLocalStorageStub({ 'flag:autoSave.enabled': 'true' })
    const scope = globalThis as typeof globalThis & { localStorage?: LocalStorageStub }
    const previousDescriptor = Object.getOwnPropertyDescriptor(scope, 'localStorage')
    Object.defineProperty(scope, 'localStorage', {
      value: storage,
      configurable: true,
      writable: true
    })
    t.after(() => {
      storage.clear()
      if (previousDescriptor) {
        Object.defineProperty(scope, 'localStorage', previousDescriptor)
      } else {
        delete scope.localStorage
      }
    })

    const runner = initAutoSave(() => makeStoryboard(['legacy-storage']), { disabled: false })
    assert.notEqual(runner.snapshot().phase, 'disabled')
    runner.markDirty({ pendingBytes: 256 })

    const telemetry = runnerTelemetry.filter(
      (event) => event.detail?.event === 'autosave.schedule.requested'
    )
    assert.ok(telemetry.length > 0)
    const last = telemetry.at(-1)!
    assert.equal(last.detail?.flag_source, 'localStorage')
  }
)

scenario('disabled guard returns no-op handle', async (t: TestContext, { initAutoSave }) => {
  const scope = globalThis as typeof globalThis & {
    __AUTOSAVE_ENABLED__?: boolean
    Day8Collector?: { publish: (event: Record<string, unknown>) => void }
  }
  const events: Record<string, unknown>[] = []
  Object.defineProperty(scope, 'Day8Collector', {
    value: { publish: (event: Record<string, unknown>) => { events.push(event) } },
    configurable: true
  })
  t.after(() => {
    delete scope.Day8Collector
  })

  for (const { flag, options, reason } of [
    { flag: false, options: { disabled: false }, reason: 'feature-flag-disabled' as const },
    { flag: true, options: { disabled: true }, reason: 'options-disabled' as const }
  ]) {
    events.length = 0
    scope.__AUTOSAVE_ENABLED__ = flag
    const runner = initAutoSave(() => makeStoryboard([]), options)
    assert.equal(runner.snapshot().phase, 'disabled')
    await assert.doesNotReject(() => runner.flushNow())
    await runner.dispose()
    const disposedSnapshot = runner.snapshot()
    assert.equal(disposedSnapshot.phase, 'disabled')
    assert.deepEqual(
      events.map((event) => ({
        level: event.level as string,
        reason: event.reason as string
      })),
      [{ level: 'debug', reason }]
    )
    delete scope.__AUTOSAVE_ENABLED__
  }
})

scenario(
  'lock failure surfaces AutoSaveError with retryable flag',
  { locks: { async request(){ throw new Error('denied') } } },
  async (_t, { initAutoSave }) => {
    const runner = initAutoSave(() => makeStoryboard([]), { disabled: false }, ENABLED_GUARD)
    await assert.rejects(runner.flushNow(), isAutoSaveError({ code: 'lock-unavailable', retryable: true }))
    assert.equal(runner.snapshot().phase, 'backoff')
    assert.equal(runner.snapshot().retryCount, 1)
  }
)
