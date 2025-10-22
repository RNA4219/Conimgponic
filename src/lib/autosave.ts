import type { Storyboard } from '../types'

export type StoryboardProvider = () => Storyboard

export interface AutoSaveOptions {
  debounceMs?: number
  idleMs?: number
  maxGenerations?: number
  maxBytes?: number
  disabled?: boolean
}

/**
 * 保存ポリシー既定値。`docs/AUTOSAVE-DESIGN-IMPL.md` §1.1 の表と同期する必要がある。
 */
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

export interface AutoSaveRetryPolicy {
  readonly initialDelayMs: number
  readonly multiplier: number
  readonly maxDelayMs: number
  readonly maxAttempts: number
}

export const AUTOSAVE_RETRY_POLICY: AutoSaveRetryPolicy = Object.freeze({
  initialDelayMs: 500,
  multiplier: 2,
  maxDelayMs: 4000,
  maxAttempts: 5
})

export type AutoSavePhaseTransitionMap = Readonly<Record<AutoSavePhase, readonly string[]>>

export const AUTOSAVE_STATE_TRANSITION_MAP: AutoSavePhaseTransitionMap = Object.freeze({
  disabled: ['idle:init|タイマー初期化+監視開始'],
  idle: ['debouncing:change-detected|debounce セット+pendingBytes 集計', 'awaiting-lock:flushNow|手動保存→即時ロック取得', 'disabled:dispose|監視解除+ロック解放+タイマー停止'],
  debouncing: ['idle:debounce-cancelled|pendingBytes リセット', 'awaiting-lock:idle-confirmed|ロック要求開始+phase 更新', 'awaiting-lock:flushNow|手動保存→デバウンスキャンセル+即時ロック', 'disabled:dispose|監視解除+ジョブキャンセル'],
  'awaiting-lock': ['writing-current:lock-acquired|current.json.tmp 書込+retryCount リセット', 'debouncing:lock-retry|retryable&&attempts<maxAttempts→バックオフ', 'error:flight-error|retryable=false or attempts>=maxAttempts', 'disabled:dispose|ロック要求取消+バックオフ解除'],
  'writing-current': ['updating-index:write-committed|rename+index 更新準備', 'error:flight-error|ロールバック+retryCount++', 'disabled:dispose|フライト完了待機後ロック解放'],
  'updating-index': ['gc:index-committed|履歴 FIFO+容量再計算', 'error:flight-error|index ロールバック+retryCount++', 'disabled:dispose|フライト完了待機+整合維持'],
  gc: ["idle:gc-complete|lastSuccessAt 更新+pendingBytes クリア", 'disabled:dispose|GC 完了待ち→容量監査結果破棄'],
  error: ['awaiting-lock:retry-scheduled|retryable=true→バックオフ完了で復帰', 'disabled:dispose|再試行キュークリア+phase disabled']
} as const)

export interface AutoSaveHistoryEntry {
  readonly ts: string
  readonly bytes: number
  readonly location: 'current' | 'history'
  readonly retained: boolean
}

export interface AutoSaveHistoryRotationPlan {
  readonly targetDirectory: string
  readonly indexFile: string
  readonly currentFile: string
  readonly maxGenerations: number
  readonly maxBytes: number
  readonly gcOrder: 'fifo'
  readonly cleanupOrphans: boolean
}

export const AUTOSAVE_HISTORY_ROTATION_PLAN: AutoSaveHistoryRotationPlan = Object.freeze({ targetDirectory: 'project/autosave', indexFile: 'project/autosave/index.json', currentFile: 'project/autosave/current.json', maxGenerations: AUTOSAVE_DEFAULTS.maxGenerations, maxBytes: AUTOSAVE_DEFAULTS.maxBytes, gcOrder: 'fifo', cleanupOrphans: true })

export interface AutoSaveSchedulerContract {
  readonly start: () => void
  readonly scheduleFlush: (reason: 'change' | 'flushNow') => void
  readonly awaitIdle: () => Promise<void>
  readonly dispose: () => Promise<void>
}

export interface AutoSavePersistenceContract {
  readonly writeCurrent: (payload: Storyboard) => Promise<{ bytes: number }>
  readonly updateIndex: (entry: AutoSaveHistoryEntry) => Promise<void>
  readonly rotateHistory: (
    entries: readonly AutoSaveHistoryEntry[],
    options?: { enforceBytes?: boolean }
  ) => Promise<readonly AutoSaveHistoryEntry[]>
}

export interface AutoSaveInitResult {
  readonly snapshot: () => AutoSaveStatusSnapshot
  flushNow: () => Promise<void>
  dispose: () => void
}

export interface AutoSaveTelemetryEvent {
  readonly feature: 'autosave'
  readonly phase: AutoSavePhase
  readonly at: string
  readonly detail?: Record<string, unknown>
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

/**
 * AutoSave スケジューラを初期化する。
 *
 * 副作用: Web Locks/フォールバックロックの取得、`current.json`/`index.json` への書き込み、履歴 GC/容量制限の適用。
 * 例外: `AutoSaveError` を throw。`disabled` 判定時は `code='disabled'` を使用し、Collector への通知は行わない。
 * フラグ `autosave.enabled=false` または `options.disabled=true` の場合は永続化を一切行わず、`phase='disabled'` のスナップショットと no-op な `flushNow` を返す。
 */
export function initAutoSave(
  getStoryboard: StoryboardProvider,
  options?: AutoSaveOptions
): AutoSaveInitResult {
  throw new Error('initAutoSave not implemented yet')
}

/**
 * 復元候補を提示するためのメタデータを取得する。
 *
 * 副作用: OPFS 読み出しのみ。
 * 例外: `code='data-corrupted'` の `AutoSaveError` を throw。
 */
export async function restorePrompt(): Promise<
  | null
  | { ts: string; bytes: number; source: 'current' | 'history'; location: string }
> {
  throw new Error('restorePrompt not implemented yet')
}

/**
 * `current.json` から storyboard を復元し UI へ適用する。
 *
 * 副作用: UI ステート更新のみ（永続化書き込みなし）。
 * 例外: `code='data-corrupted'` の `AutoSaveError` を throw。
 */
export async function restoreFromCurrent(): Promise<boolean> {
  throw new Error('restoreFromCurrent not implemented yet')
}

/**
 * 指定した履歴タイムスタンプから storyboard を復元する。
 *
 * 副作用: 履歴ファイル読み込み、必要に応じたロック取得、UI ステート更新。
 * 例外: `code='data-corrupted'` または `code='lock-unavailable'` の `AutoSaveError` を throw。
 */
export async function restoreFrom(ts: string): Promise<boolean> {
  throw new Error('restoreFrom not implemented yet')
}

/**
 * `index.json` の履歴一覧を返す。
 *
 * 副作用: OPFS 読み出しのみ。
 * 例外: `code='data-corrupted'` の `AutoSaveError` を throw。
 */
export async function listHistory(): Promise<
  { ts: string; bytes: number; location: 'history'; retained: boolean }[]
> {
  throw new Error('listHistory not implemented yet')
}
