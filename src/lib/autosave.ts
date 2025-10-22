import type { Storyboard } from '../types'

export type StoryboardProvider = () => Storyboard

export interface AutoSaveOptions {
  /**
   * フラグ/ユーザー設定による完全無効化。`true` の場合は initAutoSave が no-op を返し、副作用を発生させない。
   */
  readonly disabled?: boolean
  /**
   * @deprecated 保存ポリシーは `AUTOSAVE_POLICY` 固定。上書きはサポートしない。
   */
  readonly debounceMs?: never
  /**
   * @deprecated 保存ポリシーは `AUTOSAVE_POLICY` 固定。上書きはサポートしない。
   */
  readonly idleMs?: never
  /**
   * @deprecated 保存ポリシーは `AUTOSAVE_POLICY` 固定。上書きはサポートしない。
   */
  readonly maxGenerations?: never
  /**
   * @deprecated 保存ポリシーは `AUTOSAVE_POLICY` 固定。上書きはサポートしない。
   */
  readonly maxBytes?: never
}

export interface AutoSavePolicy {
  readonly debounceMs: 500
  readonly idleMs: 2000
  readonly maxGenerations: 20
  readonly maxBytes: 50 * 1024 * 1024
  readonly disabled: false
}

/**
 * 保存ポリシー既定値。`docs/AUTOSAVE-DESIGN-IMPL.md` §1.1 の表と同期する必要がある。
 */
export const AUTOSAVE_POLICY: AutoSavePolicy = Object.freeze({
  debounceMs: 500,
  idleMs: 2000,
  maxGenerations: 20,
  maxBytes: 50 * 1024 * 1024,
  disabled: false
} as const)

export const AUTOSAVE_DEFAULTS = AUTOSAVE_POLICY

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

export interface AutoSaveErrorNotificationFlow {
  readonly code: AutoSaveErrorCode | 'any'
  readonly retryable: boolean
  readonly ui: 'none' | 'toast' | 'modal'
  readonly collectorLevel: 'debug' | 'info' | 'warn' | 'error'
  readonly message: string
}

export const AUTOSAVE_ERROR_NOTIFICATION_FLOWS = Object.freeze<readonly AutoSaveErrorNotificationFlow[]>([
  { code: 'disabled', retryable: false, ui: 'none', collectorLevel: 'debug', message: 'Feature flag/オプションによる停止。UI 通知なしで snapshot.phase を disabled とする。' },
  { code: 'lock-unavailable', retryable: true, ui: 'toast', collectorLevel: 'warn', message: 'Web Lock 取得失敗。バックオフ再試行を UI に表示し、Collector へ単発 warn を送る。' },
  { code: 'write-failed', retryable: true, ui: 'toast', collectorLevel: 'warn', message: 'OPFS 書込失敗。retryCount を UI に表示し、cause/context を構造化して送信。' },
  { code: 'data-corrupted', retryable: false, ui: 'modal', collectorLevel: 'error', message: '復元不能。ユーザーに復旧不可を通知し、Collector へ高優先度 error を送る。' },
  { code: 'history-overflow', retryable: false, ui: 'toast', collectorLevel: 'info', message: '履歴 FIFO により世代を削除。ユーザーへ情報通知のみ。' },
  { code: 'any', retryable: false, ui: 'modal', collectorLevel: 'error', message: '未分類エラーはフォールバックで致命扱いとし、UI/Collector へ escalated 通知を行う。' }
])

export const AUTOSAVE_DISABLED_CONDITIONS = Object.freeze({
  featureFlag: 'autosave.enabled=false',
  optionsDisabled: 'AutoSaveOptions.disabled=true',
  runtimeOverride: 'StoryboardProvider が undefined を返した場合は初期化自体を拒否する'
} as const)

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

export interface AutoSavePhaseDescription {
  readonly summary: string
  readonly entry: readonly string[]
  readonly exit: readonly string[]
}

export const AUTOSAVE_PHASE_DESCRIPTIONS: Readonly<Record<AutoSavePhase, AutoSavePhaseDescription>> = Object.freeze({
  disabled: { summary: 'AutoSave 全停止状態。監視やロック取得を行わない。', entry: ['scheduleFlush を解除', 'Web Lock/ファイルロックを解放', 'Telemetry を抑制'], exit: ['StoryboardProvider を即時評価', '監視タイマーを初期化'] },
  idle: { summary: '変更待ちの安定状態。次の保存を監視する。', entry: ['pendingBytes を 0 にリセット', 'retryCount を 0 にリセット'], exit: ['debounce タイマーをセット', 'flushNow でロック要求へ移行'] },
  debouncing: { summary: '変更を集約し、最小保存間隔を担保する。', entry: ['pendingBytes を算出', 'idle タイマーをセット'], exit: ['pendingBytes を確定', 'idle タイマーをクリア'] },
  'awaiting-lock': { summary: 'ロック取得中。Web Lock 優先でフォールバックに繋ぐ。', entry: ['lock request を発行', 'retryCount を監視'], exit: ['バックオフタイマーを解除', 'ロックハンドルを確保または解放'] },
  'writing-current': { summary: 'current.json.tmp へアトミックに書き込み中。', entry: ['StoryboardProvider の出力を serialize', 'writeCurrent を呼び出す'], exit: ['writeCurrent の Promise 解決を待つ', 'pendingBytes を更新'] },
  'updating-index': { summary: 'index.json を更新し履歴メタデータを整備する。', entry: ['updateIndex を呼び出し最新世代を先頭に挿入'], exit: ['index.json の整合性を検証', 'GC 判定の入力を準備'] },
  gc: { summary: '履歴世代/容量制限を満たすようクリーンアップする。', entry: ['rotateHistory を呼び出し', '削除対象を決定'], exit: ['lastSuccessAt を更新', 'pendingBytes をクリア'] },
  error: { summary: 'UI/Collector へ公開する致命/警告状態。', entry: ['AutoSaveError を snapshot.lastError に格納', 'telemetry に code/retryable を添付'], exit: ['retryCount を次試行へ引き継ぐ', 'バックオフ完了を待機'] }
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
  /**
   * デバウンス/アイドル待機をスキップして即座に `awaiting-lock` へ遷移させる。
   * 実行中の書込フェーズがある場合はその完了を待った後に再実行をスケジュールする。
   */
  flushNow: () => Promise<void>
  /**
   * タイマー停止・イベント購読解除・ロック開放を順番に実行する終端処理。
   * フライト中の場合でも完了を待機してから `phase='disabled'` に確定させる。
   */
  dispose: () => void
}

export interface AutoSaveControlResponsibility {
  readonly name: 'flushNow' | 'dispose'
  readonly allowedPhases: readonly AutoSavePhase[]
  readonly operations: readonly string[]
  readonly failureModes: readonly AutoSaveErrorCode[]
}

export const AUTOSAVE_CONTROL_RESPONSIBILITIES = Object.freeze<readonly AutoSaveControlResponsibility[]>([
  { name: 'flushNow', allowedPhases: ['idle', 'debouncing', 'awaiting-lock', 'error'], operations: ['debounce タイマーを解除', 'ロック取得を要求', 'retryable error の場合はバックオフ完了後に再実行'], failureModes: ['lock-unavailable', 'write-failed'] },
  { name: 'dispose', allowedPhases: ['disabled', 'idle', 'debouncing', 'awaiting-lock', 'writing-current', 'updating-index', 'gc', 'error'], operations: ['scheduler/タイマーの停止', '保留ロック/バックオフの破棄', 'final snapshot を phase=\'disabled\' で確定'], failureModes: ['lock-unavailable', 'write-failed'] }
])

export interface AutoSaveTelemetryEvent {
  readonly feature: 'autosave'
  readonly phase: AutoSavePhase
  readonly at: string
  readonly detail?: Record<string, unknown>
}

export type AutoSaveRunnerEventType =
  | 'change-queued'
  | 'lock-acquired'
  | 'lock-rejected'
  | 'retry-scheduled'
  | 'retry-exhausted'
  | 'write-succeeded'
  | 'write-failed'
  | 'gc-completed'
  | 'cancelled'

export interface AutoSaveRunnerEvent {
  readonly type: AutoSaveRunnerEventType
  readonly phase: AutoSavePhase
  readonly at: string
  readonly payload?: Record<string, unknown>
  readonly error?: AutoSaveError
}

export interface AutoSaveRunnerEventSpec {
  readonly type: AutoSaveRunnerEventType
  readonly summary: string
  readonly emittedFrom: readonly AutoSavePhase[]
  readonly telemetrySlo: 'p99-success' | 'p95-latency'
  readonly notes: readonly string[]
}

export const AUTOSAVE_RUNNER_EVENT_SPECS: readonly AutoSaveRunnerEventSpec[] = Object.freeze([
  {
    type: 'change-queued',
    summary: 'UI からの変更検知を保存キューへ登録しデバウンスを開始する',
    emittedFrom: ['idle'],
    telemetrySlo: 'p95-latency',
    notes: ['Phase A では change→lock-acquired まで 2.5s 以内']
  },
  {
    type: 'lock-acquired',
    summary: 'Web Lock/フォールバックロックが確保され保存フライトへ遷移する',
    emittedFrom: ['debouncing', 'awaiting-lock'],
    telemetrySlo: 'p95-latency',
    notes: ['lock lease を payload.leaseMs に記録', 'retryCount をリセット']
  },
  {
    type: 'lock-rejected',
    summary: 'ロック取得に失敗しバックオフ要否を判定する',
    emittedFrom: ['awaiting-lock'],
    telemetrySlo: 'p95-latency',
    notes: ['error.retryable=true なら retry-scheduled へ続く', 'retryable=false なら retry-exhausted を経ずに error 固定']
  },
  {
    type: 'retry-scheduled',
    summary: 'retryable な失敗を指数バックオフで再試行キューへ登録する',
    emittedFrom: ['error'],
    telemetrySlo: 'p95-latency',
    notes: ['backoff delay を payload.delayMs として公開', 'Phase A-1 の監視対象 (retryCount>=3)']
  },
  {
    type: 'retry-exhausted',
    summary: '最大試行回数を超過したためエラーを確定し手動復旧待ちとする',
    emittedFrom: ['awaiting-lock', 'writing-current'],
    telemetrySlo: 'p95-latency',
    notes: ['Collector へ escalated=error を送信', 'UI 表示は phase=error を維持']
  },
  {
    type: 'write-succeeded',
    summary: 'current.json.tmp への書込と rename が完了し index 更新へ進む',
    emittedFrom: ['writing-current'],
    telemetrySlo: 'p99-success',
    notes: ['payload.bytes に書込サイズを格納', 'lastSuccessAt の候補時刻になる']
  },
  {
    type: 'write-failed',
    summary: '書き込みフェーズで非致命エラーが発生し再試行判定を行う',
    emittedFrom: ['writing-current'],
    telemetrySlo: 'p95-latency',
    notes: ['error.retryable=true なら retry-scheduled へ遷移', 'retryable=false なら retry-exhausted を生成する']
  },
  {
    type: 'gc-completed',
    summary: '履歴ローテーションと容量調整が完了し idle へ復帰する',
    emittedFrom: ['gc'],
    telemetrySlo: 'p99-success',
    notes: ['payload.retained に保持世代一覧を格納', 'Phase A P99 成功計測の対象イベント']
  },
  {
    type: 'cancelled',
    summary: 'dispose などのキャンセル操作で保存フローを停止する',
    emittedFrom: ['debouncing', 'awaiting-lock', 'error'],
    telemetrySlo: 'p95-latency',
    notes: ['pending キューをクリア', 'phase=disabled へ遷移']
  }
])

export interface AutoSaveQueueEntry {
  readonly ts: string
  readonly reason: 'change' | 'flushNow'
  readonly estimatedBytes: number
  readonly retries: number
}

export interface AutoSaveRunnerQueueModel {
  readonly pending: readonly AutoSaveQueueEntry[]
  readonly enqueue: (entry: AutoSaveQueueEntry) => void
  readonly shift: () => AutoSaveQueueEntry | undefined
  readonly cancel: (predicate: (entry: AutoSaveQueueEntry) => boolean) => number
}

export interface AutoSaveRunnerQueuePolicy {
  readonly maxPending: number
  readonly coalesceWindowMs: number
  readonly flushReasons: readonly AutoSaveQueueEntry['reason'][]
  readonly discardOn: readonly ('dispose' | 'retry-exhausted')[]
}

export const AUTOSAVE_QUEUE_POLICY: AutoSaveRunnerQueuePolicy = Object.freeze({
  maxPending: 5,
  coalesceWindowMs: AUTOSAVE_POLICY.debounceMs,
  flushReasons: ['change', 'flushNow'],
  discardOn: ['dispose', 'retry-exhausted']
})

export interface AutoSaveRunnerIOContract {
  readonly input: {
    readonly featureFlag: boolean
    readonly optionsDisabled: boolean | undefined
    readonly lockAcquired: (leaseMs: number) => void
    readonly lockRejected: (reason: AutoSaveError) => void
    readonly snapshot: () => AutoSaveStatusSnapshot
  }
  readonly output: {
    readonly emit: (event: AutoSaveRunnerEvent) => void
    readonly telemetry: (event: AutoSaveTelemetryEvent & { readonly slo: 'p99-success' | 'p95-latency' }) => void
  }
}

export interface AutoSaveRunnerApiSurface {
  readonly start: () => Promise<void>
  readonly enqueue: (reason: 'change' | 'flushNow') => Promise<void>
  readonly cancel: (reason: 'flushNow' | 'dispose') => Promise<void>
  readonly onEvent: (handler: (event: AutoSaveRunnerEvent) => void) => () => void
}

export interface AutoSaveRunnerTransitionSpec {
  readonly from: AutoSavePhase
  readonly to: AutoSavePhase
  readonly via: AutoSaveRunnerEventType
  readonly guard: string
  readonly actions: readonly string[]
}

export const AUTOSAVE_RUNNER_TRANSITIONS: readonly AutoSaveRunnerTransitionSpec[] = Object.freeze([
  {
    from: 'idle',
    to: 'debouncing',
    via: 'change-queued',
    guard: 'autosave.enabled=true && options.disabled!=true',
    actions: ['デバウンスタイマー起動', 'pendingBytes を更新']
  },
  {
    from: 'debouncing',
    to: 'awaiting-lock',
    via: 'lock-acquired',
    guard: 'WebLock 取得成功',
    actions: ['retryCount をリセット', '書込フェーズを起動']
  },
  {
    from: 'awaiting-lock',
    to: 'error',
    via: 'lock-rejected',
    guard: 'retryable=false または attempts>=max',
    actions: ['バックオフ停止', 'snapshot.lastError を更新']
  },
  {
    from: 'awaiting-lock',
    to: 'error',
    via: 'retry-exhausted',
    guard: 'attempts>=maxAttempts',
    actions: ['バックオフ停止', 'phase=error を固定']
  },
  {
    from: 'writing-current',
    to: 'updating-index',
    via: 'write-succeeded',
    guard: 'writeCurrent 完了',
    actions: ['index 更新をスケジュール', 'pendingBytes を確定']
  },
  {
    from: 'writing-current',
    to: 'error',
    via: 'write-failed',
    guard: 'retryable=false',
    actions: ['ロールバック', 'snapshot.lastError を更新']
  },
  {
    from: 'error',
    to: 'awaiting-lock',
    via: 'retry-scheduled',
    guard: 'retryable=true && attempts<maxAttempts',
    actions: ['バックオフ待機後に lock 要求を再開', 'retryCount++ を適用']
  },
  {
    from: 'gc',
    to: 'idle',
    via: 'gc-completed',
    guard: 'GC 完了',
    actions: ['lastSuccessAt を更新', 'queuedGeneration をクリア']
  },
  {
    from: 'debouncing',
    to: 'idle',
    via: 'cancelled',
    guard: 'dispose 呼び出し',
    actions: ['pendingQueue をクリア', 'phase=disabled へ遷移準備']
  }
])

export interface AutoSaveScenarioAssertion {
  readonly description: string
  readonly expectedPhase: AutoSavePhase
  readonly expectedEvents: readonly AutoSaveRunnerEventType[]
}

export interface AutoSaveScenarioSpec {
  readonly label: string
  readonly given: {
    readonly featureFlag: boolean
    readonly optionsDisabled?: boolean
    readonly lockAvailable: boolean
    readonly persistenceError?: AutoSaveErrorCode
  }
  readonly when: 'single-change' | 'concurrent-change' | 'flushNow' | 'dispose'
  readonly then: readonly AutoSaveScenarioAssertion[]
}

export const AUTOSAVE_TDD_SCENARIOS: readonly AutoSaveScenarioSpec[] = Object.freeze([
  {
    label: '正常系: 1 件保存が成功し GC まで完了する',
    given: { featureFlag: true, lockAvailable: true },
    when: 'single-change',
    then: [
      {
        description: '書き込み成功で idle に復帰',
        expectedPhase: 'idle',
        expectedEvents: ['change-queued', 'lock-acquired', 'write-succeeded', 'gc-completed']
      }
    ]
  },
  {
    label: '失敗系: lock 取得失敗でバックオフに入る',
    given: { featureFlag: true, lockAvailable: false },
    when: 'single-change',
    then: [
      {
        description: 'retryable error で error フェーズへ遷移',
        expectedPhase: 'error',
        expectedEvents: ['change-queued', 'lock-rejected', 'retry-scheduled']
      }
    ]
  },
  {
    label: 'キャンセル系: dispose 呼び出しでキューを破棄',
    given: { featureFlag: true, lockAvailable: true },
    when: 'dispose',
    then: [
      { description: 'cancelled イベントで disabled に遷移', expectedPhase: 'disabled', expectedEvents: ['cancelled'] }
    ]
  }
])

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
