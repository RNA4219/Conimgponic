import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { AutoSaveStatusSnapshot } from '../../../src/lib/autosave'
import {
  type AutoSaveHistorySummary,
  type AutoSaveIndicatorLockState,
  AUTOSAVE_INDICATOR_MESSAGE_SPEC,
  AUTOSAVE_PHASE_STATE_MAP,
  deriveAutoSaveIndicatorViewModel,
  resolveAutoSaveIndicatorMessageSpecKey,
  buildAutoSaveIndicatorHistoryView,
  buildAutoSaveIndicatorBanner,
  buildAutoSaveIndicatorToast
} from '../../../src/lib/autosave/indicatorViewModel'

describe('deriveAutoSaveIndicatorViewModel', () => {
  test('履歴利用率が閾値を超えた場合に警告を表示しつつアクセスは維持する', () => {
    const snapshot: AutoSaveStatusSnapshot = {
      phase: 'idle',
      retryCount: 0,
      pendingBytes: 0,
      lastSuccessAt: '2024-05-01T00:00:00Z'
    }
    const historySummary: AutoSaveHistorySummary = {
      totalGenerations: 18,
      maxGenerations: 20,
      totalBytes: 90_000,
      maxBytes: 100_000
    }

    const viewModel = deriveAutoSaveIndicatorViewModel({ snapshot, historySummary })

    assert.equal(viewModel.history.access, 'available')
    assert.ok(viewModel.history.usageWarning?.includes('90%'))
    assert.equal(viewModel.history.note, viewModel.history.note)
  })

  test('awaiting-lock での再試行時に進捗表示と履歴遮断を行う', () => {
    const snapshot: AutoSaveStatusSnapshot = {
      phase: 'awaiting-lock',
      retryCount: 4,
      pendingBytes: 0,
      lastSuccessAt: '2024-05-01T00:00:00Z'
    }

    const viewModel = deriveAutoSaveIndicatorViewModel({ snapshot })

    assert.equal(viewModel.indicator, 'progress')
    assert.equal(viewModel.history.access, 'disabled')
    assert.equal(viewModel.meta.retryCount, 4)
    assert.match(viewModel.meta.retryLabel ?? '', /再試行/)
    assert.ok(viewModel.isAnimating)
    assert.equal(viewModel.toast?.variant, 'warning')
  })

  test('閲覧専用ロックで履歴を無効化し警告バナーを表示する', () => {
    const snapshot: AutoSaveStatusSnapshot = {
      phase: 'idle',
      retryCount: 0,
      pendingBytes: 0,
      lastSuccessAt: '2024-05-01T00:00:00Z'
    }
    const lockState: AutoSaveIndicatorLockState = {
      mode: 'readonly',
      reason: 'acquire-failed',
      since: Date.now()
    }

    const viewModel = deriveAutoSaveIndicatorViewModel({ snapshot, lockState })

    assert.equal(viewModel.statusLabel, '閲覧専用モード')
    assert.equal(viewModel.history.access, 'disabled')
    assert.equal(viewModel.history.note, AUTOSAVE_INDICATOR_MESSAGE_SPEC.readonlyEntered.notes[0])
    assert.equal(viewModel.banner?.variant, 'warning')
    assert.ok(viewModel.isReadOnly)
  })

  test('再試行可能エラー時は履歴アクセスを再開し Spec のトーストを表示する', () => {
    const snapshot: AutoSaveStatusSnapshot = {
      phase: 'awaiting-lock',
      retryCount: 4,
      pendingBytes: 2048,
      lastSuccessAt: '2024-05-01T00:00:00Z',
      lastError: { code: 'lock-unavailable', retryable: true, message: 'Lock busy' }
    }

    const viewModel = deriveAutoSaveIndicatorViewModel({ snapshot })

    const expectedToastMessage =
      AUTOSAVE_INDICATOR_MESSAGE_SPEC.retryableFailure.toast?.message?.replace('{{error.message}}', 'Lock busy') ?? ''

    assert.equal(viewModel.history.access, 'available')
    assert.equal(viewModel.history.note, AUTOSAVE_INDICATOR_MESSAGE_SPEC.retryableFailure.notes[0])
    assert.equal(viewModel.history.canOpen, true)
    assert.equal(viewModel.toast?.variant, 'warning')
    assert.equal(viewModel.toast?.message, expectedToastMessage)
  })

  test('ヘルパー関数でメッセージ種別・履歴・バナー・トーストを計算できる', () => {
    const snapshot: AutoSaveStatusSnapshot = {
      phase: 'error',
      retryCount: 3,
      pendingBytes: 0,
      lastSuccessAt: '2024-05-01T00:00:00Z',
      lastError: { code: 'fatal-error', retryable: false, message: '致命的エラー' }
    }

    const messageKey = resolveAutoSaveIndicatorMessageSpecKey({
      snapshot,
      isReadOnly: false
    })
    assert.equal(messageKey, 'fatalFailure')

    const historyView = buildAutoSaveIndicatorHistoryView({
      base: AUTOSAVE_PHASE_STATE_MAP.error.history,
      historySummary: undefined,
      isReadOnly: false,
      messageSpec: AUTOSAVE_INDICATOR_MESSAGE_SPEC[messageKey!],
      readonlyNote: AUTOSAVE_INDICATOR_MESSAGE_SPEC.readonlyEntered.notes[0]
    })
    assert.equal(historyView.access, 'available')
    assert.equal(historyView.canOpen, true)

    const banner = buildAutoSaveIndicatorBanner({
      isReadOnly: false,
      lockState: undefined,
      effectiveLockEvent: undefined,
      messageSpec: AUTOSAVE_INDICATOR_MESSAGE_SPEC[messageKey!],
      messageSpecKey: messageKey,
      snapshot
    })
    assert.ok(banner)
    assert.equal(banner?.variant, 'error')

    const toast = buildAutoSaveIndicatorToast({
      messageSpec: AUTOSAVE_INDICATOR_MESSAGE_SPEC[messageKey!],
      snapshot
    })
    assert.equal(toast, undefined)
  })
})
