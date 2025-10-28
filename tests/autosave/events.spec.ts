import assert from 'node:assert/strict'

import { ENABLED_GUARD, scenario } from '../lib/autosave/setup'
import type { Storyboard } from '../../src/types'
import type { AutoSaveRunnerEvent } from '../../src/lib/autosave'

const createStoryboard = (): Storyboard => ({
  id: 'autosave-test',
  title: 'AutoSave Event Test',
  scenes: [
    { id: 'alpha', manual: '', ai: '', status: 'idle', assets: [] },
    { id: 'beta', manual: '', ai: '', status: 'idle', assets: [] }
  ],
  selection: [],
  version: 1
})

scenario('AS-TEL-02: change→lock→gc 各イベントでテレメトリが同期する', async (t, ctx) => {
  const { initAutoSave, runnerTelemetry } = ctx

  const runner = initAutoSave(() => createStoryboard(), { disabled: false }, ENABLED_GUARD)
  const events: AutoSaveRunnerEvent[] = []
  const unsubscribe = runner.onEvent((event) => events.push(event))
  t.after(() => unsubscribe())
  t.after(() => runner.dispose())

  runner.markDirty({ pendingBytes: 512 })
  await runner.flushNow()

  const expectedTypes: Array<AutoSaveRunnerEvent['type']> = [
    'change-queued',
    'lock-acquired',
    'gc-completed'
  ]

  for (const type of expectedTypes) {
    const event = events.find((candidate) => candidate.type === type)
    assert.ok(event, `expected ${type} event`)

    const telemetryMatches = runnerTelemetry.filter(
      (telemetry) => telemetry.detail?.event === type && telemetry.at === event.at
    )
    assert.ok(telemetryMatches.length > 0, `expected telemetry for ${type}`)

    for (const telemetry of telemetryMatches) {
      assert.equal(telemetry.phase, event.phase)
      const detail = telemetry.detail ?? {}
      const { event: telemetryEvent, ...rest } = detail
      assert.equal(telemetryEvent, type)
      if (event.payload) {
        assert.deepEqual(rest, event.payload)
      } else {
        assert.deepEqual(rest, {})
      }
    }
  }
})
