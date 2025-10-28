import assert from 'node:assert/strict'

import { ENABLED_GUARD, scenario } from '../lib/autosave/setup'
import type { Storyboard } from '../../src/types'
type AutoSavePhase = import('../../src/lib/autosave').AutoSavePhase
type AutoSaveRunnerEvent = import('../../src/lib/autosave').AutoSaveRunnerEvent

const createStoryboard = (): Storyboard => ({
  id: 'autosave-test',
  title: 'AutoSave Test',
  scenes: [
    { id: 'alpha', manual: '', ai: '', status: 'idle', assets: [] },
    { id: 'beta', manual: '', ai: '', status: 'idle', assets: [] }
  ],
  selection: [],
  version: 1
})

/**
 * AS-I-04: flushNow と自動タイマーが正しくフェーズ遷移を行うことを確認
 * - 自動tickでdebounce→awaiting-lock→idleへの遷移を検証
 * - flushNow()が遅延をバイパスして即時フラッシュされることを検証
 */
scenario('AS-I-04: flushNow and timers drive expected phase transitions', async (t, ctx) => {
  const { initAutoSave, AUTOSAVE_POLICY, opfs } = ctx

  // モックタイマー有効化
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'], now: 0 })

  const runner = initAutoSave(() => createStoryboard(), { disabled: false }, ENABLED_GUARD)
  const events: AutoSaveRunnerEvent[] = []
  const unsubscribe = runner.onEvent((event) => events.push(event))
  t.after(() => unsubscribe())
  t.after(() => runner.dispose())
  assert.equal(runner.snapshot().phase, 'idle')

  // ---- 自動debounceフェーズ ----
  runner.markDirty({ pendingBytes: 128 })
  assert.equal(runner.snapshot().phase, 'dirty')

  // debounce期間内 → 変化なし
  t.mock.timers.tick(AUTOSAVE_POLICY.debounceMs + AUTOSAVE_POLICY.idleMs - 1)
  await Promise.resolve()
  assert.equal(runner.snapshot().phase, 'dirty')

  // debounce完了 → awaiting-lock 経由で idle に戻る
  t.mock.timers.tick(1)
  await Promise.resolve()
  assert.equal(runner.snapshot().phase, 'awaiting-lock')
  await Promise.resolve()
  assert.equal(runner.snapshot().phase, 'idle')
  assert.ok(opfs.files.has('project/autosave/current.json'))

  // ---- flushNow() 即時バイパス検証 ----
  runner.markDirty({ pendingBytes: 1024 })
  assert.equal(runner.snapshot().phase, 'debouncing')

  const timeline: AutoSavePhase[] = []
  const pending = runner.flushNow()
  timeline.push(runner.snapshot().phase)
  await Promise.resolve()
  timeline.push(runner.snapshot().phase)
  await pending
  timeline.push(runner.snapshot().phase)

  // flushNow が即座に awaiting-lock 経由で idle になることを確認
  assert.ok(timeline.includes('awaiting-lock'), 'expected awaiting-lock in transition path')
  assert.equal(timeline.at(-1), 'idle')

  // ファイル生成確認
  assert.ok(opfs.files.has('project/autosave/current.json'))
  assert.ok(opfs.files.has('project/autosave/index.json'))

  const eventTypes = events.map((event) => event.type)
  assert.deepEqual(eventTypes.slice(0, 4), [
    'autosave.schedule.requested',
    'lock-acquired',
    'write-succeeded',
    'gc-completed'
  ])
  assert.deepEqual(eventTypes.slice(4, 8), [
    'autosave.schedule.requested',
    'lock-acquired',
    'write-succeeded',
    'gc-completed'
  ])
  const changePayloads = events
    .filter((event) => event.type === 'autosave.schedule.requested')
    .map((event) => event.payload?.pendingBytes)
  assert.deepEqual(changePayloads, [128, 1024])

  await runner.dispose()
})

scenario(
  'AS-TEL-01: autosave.schedule.requested telemetry exposes pending bytes during debouncing',
  async (t, ctx) => {
  const { initAutoSave, runnerTelemetry } = ctx

  const runner = initAutoSave(() => createStoryboard(), { disabled: false }, ENABLED_GUARD)
  const events: AutoSaveRunnerEvent[] = []
  const unsubscribe = runner.onEvent((event) => events.push(event))
  t.after(() => unsubscribe())
  t.after(() => runner.dispose())

  runner.markDirty({ pendingBytes: 2048 })

  const telemetry = runnerTelemetry.filter((event) => event.detail?.event === 'autosave.schedule.requested')
  assert.ok(telemetry.length > 0, 'expected autosave.schedule.requested telemetry event')

  const last = telemetry.at(-1)!
  assert.equal(last.phase, 'debouncing')
  assert.equal(last.detail?.pendingBytes, 2048)
  assert.equal(last.detail?.backlog, 1)
  assert.equal(last.detail?.flag_source, ENABLED_GUARD.featureFlag.source)
  assert.equal(last.detail?.retry_count, 0)
  assert.equal(last.slo, 'p95-latency')

  const changeEvent = events.filter((event) => event.type === 'autosave.schedule.requested').at(-1)
  assert.ok(changeEvent)
  assert.equal(changeEvent!.phase, 'idle')
  assert.equal(changeEvent!.payload?.pendingBytes, 2048)
  assert.equal(changeEvent!.payload?.backlog, 1)
})

scenario(
  'AS-TEL-03: markDirty emits autosave.schedule.requested telemetry and collector events',
  async (t, ctx) => {
    const { initAutoSave, runnerTelemetry, collectorEvents } = ctx

    const runner = initAutoSave(() => createStoryboard(), { disabled: false }, ENABLED_GUARD)
    t.after(() => runner.dispose())

    runner.markDirty({ pendingBytes: 4096 })

    const telemetryEvent = runnerTelemetry.find(
      (event) => event.detail?.event === 'autosave.schedule.requested'
    )
    assert.ok(telemetryEvent, 'runner telemetry should include autosave.schedule.requested event')
    assert.equal(telemetryEvent.phase, 'debouncing')
    assert.equal(telemetryEvent.detail?.flag_source, ENABLED_GUARD.featureFlag.source)
    assert.equal(telemetryEvent.detail?.retry_count, 0)

    const collectorEvent = collectorEvents.find(
      (event) => event.event === 'autosave.schedule.requested'
    )
    assert.ok(collectorEvent, 'collector should receive autosave.schedule.requested event')
    assert.equal(collectorEvent?.flag_source, ENABLED_GUARD.featureFlag.source)
    assert.equal(collectorEvent?.retry_count, 0)
  }
)
