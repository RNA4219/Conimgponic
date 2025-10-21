import type { Storyboard } from '../types'

export type StoryboardProvider = () => Storyboard

export interface AutoSaveOptions {
  debounceMs?: number
  idleMs?: number
  maxGenerations?: number
  maxBytes?: number
  disabled?: boolean
}

export const AUTOSAVE_DEFAULTS: Required<AutoSaveOptions> = Object.freeze({
  debounceMs: 500,
  idleMs: 2000,
  maxGenerations: 20,
  maxBytes: 50 * 1024 * 1024,
  disabled: false
})

export type AutoSaveErrorCode =
  | 'lock-unavailable'
  | 'write-failed'
  | 'data-corrupted'
  | 'history-overflow'
  | 'disabled'

export interface AutoSaveError extends Error {
  readonly code: AutoSaveErrorCode
  readonly retryable: boolean
  readonly cause?: Error
  readonly context?: Record<string, unknown>
}

export type AutoSaveFailureAction = 'backoff' | 'stop' | 'noop'

export interface AutoSaveFailurePlanEntry {
  readonly code: AutoSaveErrorCode
  readonly retryable: boolean
  readonly action: AutoSaveFailureAction
  readonly summary: string
}

export const AUTOSAVE_FAILURE_PLAN: readonly AutoSaveFailurePlanEntry[] = Object.freeze([
  {
    code: 'disabled',
    retryable: false,
    action: 'noop',
    summary: 'フラグ/オプションで無効化された場合はスケジューラを起動せず副作用を抑止する'
  },
  {
    code: 'lock-unavailable',
    retryable: true,
    action: 'backoff',
    summary: 'Web Lock/フォールバック取得失敗時は指数バックオフで再試行し、Collector への通知は 1 行に限定する'
  },
  {
    code: 'write-failed',
    retryable: true,
    action: 'backoff',
    summary: "OPFS 書込エラーは retriable として扱い、連続失敗数に応じて `phase='error'` を露出する"
  },
  {
    code: 'data-corrupted',
    retryable: false,
    action: 'stop',
    summary: '復元時に破損検知した場合は即時停止し UI 通知＋Collector への高優先度ログを送る'
  },
  {
    code: 'history-overflow',
    retryable: false,
    action: 'stop',
    summary: '容量/世代超過は FIFO で解消し、必要に応じて GC 成功後に情報ログのみを残す'
  }
])

export type AutoSavePhase =
  | 'disabled'
  | 'idle'
  | 'debouncing'
  | 'awaiting-lock'
  | 'writing-current'
  | 'updating-index'
  | 'gc'
  | 'error'

export interface AutoSaveStatusSnapshot {
  phase: AutoSavePhase
  lastSuccessAt?: string
  pendingBytes?: number
  lastError?: AutoSaveError
  retryCount: number
  queuedGeneration?: number
}

export interface AutoSaveInitResult {
  readonly snapshot: () => AutoSaveStatusSnapshot
  flushNow: () => Promise<void>
  dispose: () => void
}

export interface AutoSaveFlagScenario {
  readonly label: string
  readonly featureFlag: boolean
  readonly optionsDisabled?: boolean
  readonly expectedPhase: AutoSavePhase
  readonly assertions: readonly string[]
}

export interface AutoSaveErrorScenario {
  readonly code: AutoSaveErrorCode
  readonly expectedAction: AutoSaveFailureAction
  readonly assertions: readonly string[]
}

export const AUTOSAVE_FLAG_TEST_MATRIX: readonly AutoSaveFlagScenario[] = Object.freeze([
  {
    label: 'フラグ OFF (既定値) で no-op',
    featureFlag: false,
    expectedPhase: 'disabled',
    assertions: ['flushNow は副作用なし', 'snapshot().phase が disabled を維持', 'dispose がイベント購読を解除するのみ']
  },
  {
    label: 'フラグ ON + options.disabled=false で保存シーケンス起動',
    featureFlag: true,
    expectedPhase: 'idle',
    assertions: ['デバウンス→アイドル→ロック要求が実行される', 'flushNow がアイドル待機をスキップ', 'snapshot() が lastSuccessAt を更新する']
  },
  {
    label: 'フラグ ON + options.disabled=true で静的ガード',
    featureFlag: true,
    optionsDisabled: true,
    expectedPhase: 'disabled',
    assertions: ['flushNow は no-op', 'Collector へのイベント送信なし', 'dispose のみ実行可能']
  }
])

export const AUTOSAVE_ERROR_TEST_MATRIX: readonly AutoSaveErrorScenario[] = Object.freeze([
  {
    code: 'lock-unavailable',
    expectedAction: 'backoff',
    assertions: ['指数バックオフで再スケジュール', 'UI snapshot().retryCount が増加', 'Collector へのログは 1 行のみ']
  },
  {
    code: 'write-failed',
    expectedAction: 'backoff',
    assertions: ["再試行ごとに pendingBytes を維持", "最大リトライ後は phase='error'", 'cause/context が構造化される']
  },
  {
    code: 'data-corrupted',
    expectedAction: 'stop',
    assertions: ['即時で retryable=false', 'UI 通知が行われる', 'Collector へ高優先度ログ']
  },
  {
    code: 'history-overflow',
    expectedAction: 'stop',
    assertions: ['FIFO で古い世代を削除', 'index.json と history が再整合', '情報レベルのログのみで Analyzer へ余計な入力を渡さない']
  },
  {
    code: 'disabled',
    expectedAction: 'noop',
    assertions: ['initAutoSave 呼び出し時に AutoSaveInitResult は no-op を返す', 'ロック取得を試みない', 'Collector 出力なし']
  }
])

export function initAutoSave(
  getStoryboard: StoryboardProvider,
  options?: AutoSaveOptions
): AutoSaveInitResult {
  throw new Error('initAutoSave not implemented yet')
}

export async function restorePrompt(): Promise<
  | null
  | { ts: string; bytes: number; source: 'current' | 'history'; location: string }
> {
  throw new Error('restorePrompt not implemented yet')
}

export async function restoreFromCurrent(): Promise<boolean> {
  throw new Error('restoreFromCurrent not implemented yet')
}

export async function restoreFrom(ts: string): Promise<boolean> {
  throw new Error('restoreFrom not implemented yet')
}

export async function listHistory(): Promise<
  { ts: string; bytes: number; location: 'history'; retained: boolean }[]
> {
  throw new Error('listHistory not implemented yet')
}
