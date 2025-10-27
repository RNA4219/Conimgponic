import assert from 'node:assert/strict'

import { ENABLED_GUARD, scenario } from '../lib/autosave/setup'
import type { Storyboard } from '../../src/types'
type AutoSavePhase = import('../../src/lib/autosave').AutoSavePhase

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

  await runner.dispose()
})

scenario('AS-TEL-01: change-queued telemetry exposes pending bytes during debouncing', async (t, ctx) => {
  const { initAutoSave, runnerTelemetry } = ctx

  const runner = initAutoSave(() => createStoryboard(), { disabled: false }, ENABLED_GUARD)
  t.after(() => runner.dispose())

  runner.markDirty({ pendingBytes: 2048 })

  const telemetry = runnerTelemetry.filter((event) => event.detail?.event === 'change-queued')
  assert.ok(telemetry.length > 0, 'expected change-queued telemetry event')

  const last = telemetry.at(-1)!
  assert.equal(last.phase, 'debouncing')
  assert.equal(last.detail?.pendingBytes, 2048)
  assert.equal(last.detail?.backlog, 1)
})
