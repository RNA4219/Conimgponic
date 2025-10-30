import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { AutoSaveStatusSnapshot } from '../../../src/lib/autosave'
import {
  type AutoSaveHistorySummary,
  type AutoSaveIndicatorLockState,
  AUTOSAVE_INDICATOR_MESSAGE_SPEC,
  deriveAutoSaveIndicatorViewModel
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
})
