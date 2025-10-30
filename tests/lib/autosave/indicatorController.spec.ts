import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { AutoSaveStatusSnapshot, ProjectLockEvent } from '../../../src/lib/autosave'
import { type AutoSaveIndicatorController, createAutoSaveIndicatorController } from '../../../src/lib/autosave/indicatorController'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('createAutoSaveIndicatorController', () => {
  const createController = (initial: AutoSaveStatusSnapshot) => {
    let current = initial
    const listeners = new Set<(event: ProjectLockEvent) => void>()
    let subscribeCalls = 0
    const snapshot = () => current
    const subscribeLockEvents = (listener: (event: ProjectLockEvent) => void) => {
      subscribeCalls += 1
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
    const controller = createAutoSaveIndicatorController({
      snapshot,
      subscribeLockEvents,
      mergePrecision: 'beta',
      pollIntervalMs: 5
    })
    return {
      controller,
      setSnapshot(next: AutoSaveStatusSnapshot) {
        current = next
      },
      emitLock(event: ProjectLockEvent) {
        for (const listener of listeners) {
          listener(event)
        }
      },
      getSubscribeCalls() {
        return subscribeCalls
      }
    }
  }

  test('フェーズ遷移で phase-changed テレメトリを記録し履歴アクセスを更新する', async () => {
    const idle: AutoSaveStatusSnapshot = {
      phase: 'idle',
      retryCount: 0,
      pendingBytes: 0,
      lastSuccessAt: '2024-05-01T00:00:00Z'
    }
    const awaitingLock: AutoSaveStatusSnapshot = { ...idle, phase: 'awaiting-lock', retryCount: 0 }
    const { controller, setSnapshot } = createController(idle)

    controller.start()
    setSnapshot(awaitingLock)
    await wait(15)

    const telemetry = controller.flushTelemetry()
    assert.deepEqual(
      telemetry.filter((event) => event.type === 'phase-changed'),
      [
        {
          type: 'phase-changed',
          from: 'idle',
          to: 'awaiting-lock',
          retryCount: 0
        }
      ]
    )

    const state = controller.store.getState()
    assert.equal(state.viewModel.history.access, 'disabled')
    controller.dispose()
  })

  test('awaiting-lock で再試行が始まると retrying-started を 1 度のみ発行する', async () => {
    const base: AutoSaveStatusSnapshot = {
      phase: 'awaiting-lock',
      retryCount: 0,
      pendingBytes: 0,
      lastSuccessAt: '2024-05-01T00:00:00Z'
    }
    const { controller, setSnapshot } = createController(base)

    controller.start()
    setSnapshot({ ...base, retryCount: 1 })
    await wait(10)
    setSnapshot({ ...base, retryCount: 2 })
    await wait(10)
    setSnapshot({ ...base, retryCount: 2 })
    await wait(10)

    const events = controller.flushTelemetry().filter((event) => event.type === 'retrying-started')
    assert.equal(events.length, 1)
    assert.deepEqual(events[0], { type: 'retrying-started', phase: 'awaiting-lock', retryCount: 1 })

    controller.dispose()
  })

  test('エラー検出と閲覧専用ロックでテレメトリを発行し履歴アクセスを封鎖する', async () => {
    const idle: AutoSaveStatusSnapshot = {
      phase: 'idle',
      retryCount: 0,
      pendingBytes: 0,
      lastSuccessAt: '2024-05-01T00:00:00Z'
    }
    const { controller, setSnapshot, emitLock } = createController(idle)

    controller.start()
    setSnapshot({
      ...idle,
      phase: 'error',
      lastError: { code: 'write-failed', retryable: false, message: 'disk full' }
    })
    await wait(10)

    emitLock({ type: 'lock:readonly-entered', reason: 'acquire-failed' })
    await wait(5)

    const telemetry = controller.flushTelemetry()
    assert.ok(
      telemetry.some(
        (event) =>
          event.type === 'error-shown' &&
          event.code === 'write-failed' &&
          event.retryable === false &&
          event.phase === 'error'
      )
    )
    assert.ok(
      telemetry.some(
        (event) => event.type === 'readonly-entered' && event.reason === 'acquire-failed'
      )
    )

    const state = controller.store.getState()
    assert.equal(state.viewModel.isReadOnly, true)
    assert.equal(state.viewModel.history.access, 'disabled')

    controller.dispose()
  })

  test('start を呼ぶまでポーリングもロック購読も開始しない', async () => {
    const idle: AutoSaveStatusSnapshot = {
      phase: 'idle',
      retryCount: 0,
      pendingBytes: 0,
      lastSuccessAt: '2024-05-01T00:00:00Z'
    }
    const awaitingLock: AutoSaveStatusSnapshot = { ...idle, phase: 'awaiting-lock', retryCount: 1 }
    const { controller, setSnapshot, getSubscribeCalls } = createController(idle)

    assert.equal(getSubscribeCalls(), 0)

    setSnapshot(awaitingLock)
    await wait(20)

    assert.equal(controller.store.getState().snapshot.phase, 'idle')
    assert.equal(getSubscribeCalls(), 0)

    controller.start()
    await wait(20)

    assert.equal(controller.store.getState().snapshot.phase, 'awaiting-lock')
    assert.equal(getSubscribeCalls(), 1)

    controller.dispose()
  })
})
