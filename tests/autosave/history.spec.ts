import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TestContext } from 'node:test'

import type { AutoSaveTelemetryEvent } from '../../src/lib/autosave'
import type { Storyboard } from '../../src/types'
import { ENABLED_GUARD, scenario } from '../lib/autosave/setup'

const SNAPSHOT_ROOT = fileURLToPath(new URL('./__snapshots__/autosave/', import.meta.url))
const UPDATE_SNAPSHOTS =
  process.argv.includes('--update-snapshots') || process.env.UPDATE_SNAPSHOTS === '1'

const ensureDir = (file: string) => {
  const dir = dirname(file)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

const writeSnapshot = (relativePath: string, value: unknown) => {
  const file = join(SNAPSHOT_ROOT, relativePath)
  ensureDir(file)
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const readSnapshot = (relativePath: string): unknown => {
  const file = join(SNAPSHOT_ROOT, relativePath)
  return JSON.parse(readFileSync(file, 'utf8'))
}

const matchSnapshot = (relativePath: string, value: unknown) => {
  if (UPDATE_SNAPSHOTS) {
    writeSnapshot(relativePath, value)
    return
  }
  const expected = readSnapshot(relativePath)
  assert.deepEqual(value, expected)
}

const createStoryboard = (): Storyboard => ({
  id: 'autosave-storyboard',
  title: 'Telemetry Fixture',
  scenes: [
    { id: 'intro', manual: 'Hello', ai: '', status: 'idle', assets: [], updatedAt: '2024-05-01T00:00:00.000Z' },
    { id: 'conflict', manual: 'Conflict', ai: 'AI conflict', status: 'idle', assets: [], updatedAt: '2024-05-01T00:01:00.000Z' },
    { id: 'resolve', manual: 'Resolve', ai: '', status: 'idle', assets: [], updatedAt: '2024-05-01T00:02:00.000Z' }
  ],
  selection: [],
  version: 1
})

const parseJson = (value: string) => {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

const collectWrites = (files: Map<string, string>) =>
  Array.from(files.entries())
    .filter(([path]) => path.startsWith('project/autosave/'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, payload]) => ({ path, payload: parseJson(payload) }))

const collectTelemetry = (events: AutoSaveTelemetryEvent[]) =>
  events
    .filter((event) => event.feature === 'autosave')
    .map((event) => ({
      feature: event.feature,
      phase: event.phase,
      at: event.at,
      detail: event.detail ?? {}
    }))

const advanceAll = async (t: TestContext, ms: number) => {
  t.mock.timers.tick(ms)
  await new Promise((resolve) => setImmediate(resolve))
  await Promise.resolve()
}

scenario('AS-I-02: idle flush writes current/index/history with telemetry snapshot', async (t, ctx) => {
  const { AUTOSAVE_POLICY, initAutoSave, opfs } = ctx

  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse('2024-05-01T00:00:00.000Z') })

  const telemetry: AutoSaveTelemetryEvent[] = []
  Object.defineProperty(globalThis, 'Day8Collector', {
    value: {
      publish: (event: Record<string, unknown>) => {
        if (event.feature === 'autosave') {
          telemetry.push(event as AutoSaveTelemetryEvent)
        }
      }
    },
    configurable: true
  })
  t.after(() => {
    delete (globalThis as { Day8Collector?: unknown }).Day8Collector
  })

  const runner = initAutoSave(() => createStoryboard(), { disabled: false }, ENABLED_GUARD)
  assert.equal(runner.snapshot().phase, 'idle')

  runner.markDirty({ pendingBytes: 1024 })
  await advanceAll(t, AUTOSAVE_POLICY.debounceMs)
  assert.equal(runner.snapshot().phase, 'debouncing')

  await advanceAll(t, AUTOSAVE_POLICY.idleMs + 10)
  await advanceAll(t, 0)
  await advanceAll(t, 0)

  assert.equal(runner.snapshot().phase, 'idle')
  matchSnapshot('on/as-i-02.writes.json', collectWrites(opfs.files))
  matchSnapshot('on/as-i-02.telemetry.json', collectTelemetry(telemetry))

  await runner.dispose()
})

scenario('AS-I-05: dispose during flight keeps artefacts consistent', async (t, ctx) => {
  const { initAutoSave, opfs } = ctx

  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse('2024-05-01T01:00:00.000Z') })

  const telemetry: AutoSaveTelemetryEvent[] = []
  Object.defineProperty(globalThis, 'Day8Collector', {
    value: {
      publish: (event: Record<string, unknown>) => {
        if (event.feature === 'autosave') {
          telemetry.push(event as AutoSaveTelemetryEvent)
        }
      }
    },
    configurable: true
  })
  t.after(() => {
    delete (globalThis as { Day8Collector?: unknown }).Day8Collector
  })

  const runner = initAutoSave(() => createStoryboard(), { disabled: false }, ENABLED_GUARD)
  runner.markDirty({ pendingBytes: 2048 })

  const flush = runner.flushNow()
  await Promise.resolve()
  const disposePromise = runner.dispose()
  await assert.rejects(flush, (error) => {
    assert.equal(typeof error, 'object')
    const candidate = error as { code?: unknown }
    assert.equal(candidate?.code, 'disabled')
    return true
  })
  await disposePromise

  assert.equal(runner.snapshot().phase, 'disabled')
  matchSnapshot('on/as-i-05.writes.json', collectWrites(opfs.files))
  matchSnapshot('on/as-i-05.telemetry.json', collectTelemetry(telemetry))
})
