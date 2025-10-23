import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  deriveAutoSaveIndicatorViewModel,
  type AutoSaveHistorySummary,
  type AutoSaveIndicatorLockState
} from '../../src/components/AutoSaveIndicator'
import type { AutoSaveStatusSnapshot } from '../../src/lib/autosave'

const HISTORY_BASELINE: AutoSaveHistorySummary = {
  totalGenerations: 2,
  maxGenerations: 20,
  totalBytes: 512,
  maxBytes: 50 * 1024 * 1024
}

function createSnapshot(overrides: Partial<AutoSaveStatusSnapshot> = {}): AutoSaveStatusSnapshot {
  return {
    phase: 'idle',
    retryCount: 0,
    lastSuccessAt: '2024-10-01T00:00:00.000Z',
    pendingBytes: 0,
    ...overrides
  }
}

describe('AutoSaveIndicator view model (RED scenarios)', () => {
  it('Idle: 最新保存状態を描画できる', () => {
    // R: 安定状態のスナップショットと履歴サマリを準備
    const snapshot = createSnapshot({ phase: 'idle' })

    // E: ビューモデルを生成
    const viewModel = deriveAutoSaveIndicatorViewModel({
      snapshot,
      historySummary: HISTORY_BASELINE
    })

    // D: Idle 表示要素を検証
    assert.equal(viewModel.indicator, 'idle')
    assert.equal(viewModel.statusLabel, '最新状態')
    assert.equal(viewModel.history.access, 'available')
    assert.equal(viewModel.toast, undefined)
    assert.equal(viewModel.banner, undefined)
  })

  it('Waiting: ロック取得中は履歴操作を無効化する', () => {
    // R: awaiting-lock フェーズのスナップショットを設定
    const snapshot = createSnapshot({ phase: 'awaiting-lock', retryCount: 1 })

    // E: ビューモデルを生成
    const viewModel = deriveAutoSaveIndicatorViewModel({
      snapshot,
      historySummary: HISTORY_BASELINE
    })

    // D: 進行中表示と履歴制御を検証
    assert.equal(viewModel.indicator, 'progress')
    assert.equal(viewModel.isAnimating, true)
    assert.equal(viewModel.history.access, 'disabled')
    assert.equal(viewModel.toast, undefined)
  })

  it('Warning: 再試行警告をトーストで提示する', () => {
    // R: retryCount が閾値を超えた awaiting-lock フェーズを用意
    const snapshot = createSnapshot({ phase: 'awaiting-lock', retryCount: 3 })

    // E: ビューモデルを生成
    const viewModel = deriveAutoSaveIndicatorViewModel({
      snapshot,
      historySummary: HISTORY_BASELINE
    })

    // D: トーストに警告メッセージが含まれることを検証
    assert.equal(viewModel.indicator, 'progress')
    assert.ok(viewModel.toast)
    assert.equal(viewModel.toast?.variant, 'warning')
    assert.match(viewModel.toast?.message ?? '', /ロック取得を再試行中です \(3\)/u)
  })

  it('Readonly: 閲覧専用モードのバナーと履歴制御を行う', () => {
    // R: ReadOnly ロック状態を準備
    const lockState: AutoSaveIndicatorLockState = {
      mode: 'readonly',
      reason: 'acquire-failed',
      since: Date.now()
    }
    const snapshot = createSnapshot({ phase: 'idle' })

    // E: ビューモデルを生成
    const viewModel = deriveAutoSaveIndicatorViewModel({
      snapshot,
      historySummary: HISTORY_BASELINE,
      lockState
    })

    // D: ReadOnly 表示を検証
    assert.equal(viewModel.isReadOnly, true)
    assert.equal(viewModel.indicator, 'warning')
    assert.equal(viewModel.history.access, 'disabled')
    assert.ok(viewModel.banner)
    assert.match(viewModel.banner?.message ?? '', /閲覧専用モードに切り替わりました/u)
  })
})
