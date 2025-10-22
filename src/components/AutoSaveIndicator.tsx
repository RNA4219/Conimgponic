import { memo, useEffect, useMemo } from 'react'
import type { ReactElement } from 'react'
import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'

import type { MergePrecision } from '../config/flags'
import type { AutoSaveErrorCode, AutoSavePhase, AutoSaveStatusSnapshot } from '../lib/autosave'
import type { ProjectLockEvent, ProjectLockReadonlyReason } from '../lib/locks'

const RETRY_LABEL_THRESHOLD = 3
const HISTORY_USAGE_WARNING_RATIO = 0.9
const ANIMATING_PHASES: ReadonlySet<AutoSavePhase> = new Set([
  'debouncing',
  'awaiting-lock',
  'writing-current',
  'updating-index',
  'gc'
])
const READONLY_STATUS_LABEL = '閲覧専用モード'

export interface AutoSaveHistorySummary {
  readonly totalGenerations: number
  readonly maxGenerations: number
  readonly totalBytes: number
  readonly maxBytes: number
  readonly overflowDetected?: boolean
}

export interface AutoSavePhaseHistoryRequirement {
  readonly access: 'hidden' | 'available' | 'disabled'
  readonly note: string
}

export interface AutoSavePhaseViewConfig {
  readonly label: string
  readonly description: string
  readonly nextPhases: readonly AutoSavePhase[]
  readonly indicator: 'idle' | 'progress' | 'warning' | 'error'
  readonly history: AutoSavePhaseHistoryRequirement
}

export type AutoSaveRunnerEvent =
  | {
      readonly type: 'autosave:success'
      readonly snapshot: AutoSaveStatusSnapshot
      readonly committedGeneration: number
      readonly completedAt: string
    }
  | {
      readonly type: 'autosave:failure'
      readonly snapshot: AutoSaveStatusSnapshot
      readonly error: { readonly code: AutoSaveErrorCode; readonly message: string; readonly retryable: boolean }
      readonly failedAt: string
    }
  | {
      readonly type: 'autosave:progress'
      readonly snapshot: AutoSaveStatusSnapshot
      readonly phase: AutoSavePhase
      readonly retryCount: number
      readonly emittedAt: string
    }

export interface AutoSaveIndicatorMessageSpecEntry {
  readonly when: string
  readonly banner?: AutoSaveIndicatorBanner
  readonly toast?: AutoSaveIndicatorToast
  readonly historyAccess?: AutoSavePhaseHistoryRequirement['access']
  readonly notes: readonly string[]
}

export const AUTOSAVE_INDICATOR_MESSAGE_SPEC = Object.freeze({
  success: {
    when: '`autosave:success` 受領直後または `snapshot.phase === "idle"` へ遷移した直後',
    notes: ['バナー/トーストは表示せず、履歴アクセスは `available` を維持']
  },
  retryableFailure: {
    when:
      '`autosave:failure` かつ `error.retryable === true`。`awaiting-lock` 再試行を含む連続失敗時',
    toast: { variant: 'warning' as const, message: '自動保存の再試行に失敗しました（{{error.message}}）' },
    historyAccess: 'available',
    notes: ['履歴からの手動復元を案内しつつ自動再試行を継続']
  },
  fatalFailure: {
    when: '`snapshot.phase === "error"` かつ `lastError.retryable === false`',
    banner: { variant: 'error' as const, message: '自動保存を停止しました: {{lastError.message}}' },
    historyAccess: 'available',
    notes: ['再試行不可のため履歴経由の復元導線を強調']
  },
  readonlyEntered: {
    when: '`lock:readonly-entered` を受領、または `lockState.mode === "readonly"` へ遷移した直後',
    banner: {
      variant: 'warning' as const,
      message: '閲覧専用モードに切り替わりました（{{reasonLabel}}）'
    },
    historyAccess: 'disabled',
    notes: ['排他ロックが解除されるまで履歴操作ボタンを非活性化']
  }
} satisfies Record<'success' | 'retryableFailure' | 'fatalFailure' | 'readonlyEntered', AutoSaveIndicatorMessageSpecEntry>)

export const AUTOSAVE_PHASE_STATE_MAP = Object.freeze({
  disabled: {
    label: 'AutoSave 無効',
    description:
      'フラグ `autosave.enabled` またはオプション disabled が true。スナップショット/履歴 API は静的なまま',
    nextPhases: ['idle'],
    indicator: 'idle',
    history: {
      access: 'hidden',
      note: '永続化を行わないため `index.json` / `history/*.json` の参照 UI を表示しない'
    }
  },
  idle: {
    label: '最新状態',
    description:
      '直近の書き込みが成功し、次の変更を待機中。`lastSuccessAt` を履歴リストの最新エントリとして扱う',
    nextPhases: ['debouncing', 'disabled'],
    indicator: 'idle',
    history: {
      access: 'available',
      note: '`index.json` の降順一覧をそのまま表示し、復元・削除操作を許可する'
    }
  },
  debouncing: {
    label: '保存待機',
    description:
      '入力変化を検知し 500ms デバウンス中。`pendingBytes` を見積もりつつタイマー完了を待つ',
    nextPhases: ['idle', 'awaiting-lock'],
    indicator: 'progress',
    history: {
      access: 'available',
      note: '履歴への追加はまだ発生していないため既存エントリのみを表示（編集は許可）'
    }
  },
  'awaiting-lock': {
    label: 'ロック取得中',
    description:
      'Web Lock 優先で取得を試行。失敗時は指数バックオフで `retryCount` を更新し UI へ通知',
    nextPhases: ['writing-current', 'debouncing', 'error'],
    indicator: 'progress',
    history: {
      access: 'disabled',
      note: '同一タブ二重保存を避けるため履歴操作をブロックし、Collector ログも 1 行に抑制'
    }
  },
  'writing-current': {
    label: 'current.json 更新',
    description:
      'テンポラリへ書き込み後に原子的リネーム。失敗時は `write-failed` として再試行対象',
    nextPhases: ['updating-index', 'error'],
    indicator: 'progress',
    history: {
      access: 'disabled',
      note: '`current.json` 書換中は履歴メニューを無効化し、操作による競合を避ける'
    }
  },
  'updating-index': {
    label: 'index.json 更新',
    description:
      '履歴メタデータを更新し、世代番号をインクリメント。`queuedGeneration` を UI に反映',
    nextPhases: ['gc', 'error'],
    indicator: 'progress',
    history: {
      access: 'disabled',
      note: '`index.json` コミット前は履歴表示が不完全になるため操作を禁止'
    }
  },
  gc: {
    label: '履歴ガーベジコレクト',
    description:
      'FIFO で `maxGenerations`・`maxBytes` を満たすよう古い履歴を削除し整合性を確認',
    nextPhases: ['idle'],
    indicator: 'progress',
    history: {
      access: 'disabled',
      note: '削除対象確定までは履歴一覧と競合するためボタンを一時的に無効化'
    }
  },
  error: {
    label: 'エラー',
    description:
      '再試行不可エラーまたは連続失敗上限を超過。`lastError` 内容を表示し履歴からの復元を促す',
    nextPhases: ['idle', 'disabled'],
    indicator: 'error',
    history: {
      access: 'available',
      note: '復元操作を優先できるよう履歴メニューを常時表示し、最新成功分へ案内'
    }
  }
} satisfies Record<AutoSavePhase, AutoSavePhaseViewConfig>)

export interface AutoSaveIndicatorToast {
  readonly variant: 'warning' | 'error'
  readonly message: string
}

export interface AutoSaveIndicatorBanner {
  readonly variant: 'warning' | 'error'
  readonly message: string
}

export interface AutoSaveIndicatorLockState {
  readonly mode: 'unlocked' | 'exclusive' | 'readonly'
  readonly reason?: ProjectLockReadonlyReason
  readonly lastEvent?: ProjectLockEvent
  readonly since: number
}

export interface AutoSaveIndicatorViewModel {
  /**
   * ユーザーへ提示する状態ラベル。既存 `label` プロパティの後方互換を保つため
   * 両方へ同一値を設定する。
   */
  readonly statusLabel: string
  readonly label: string
  readonly description: string
  readonly indicator: AutoSavePhaseViewConfig['indicator']
  readonly history: AutoSavePhaseHistoryRequirement & { readonly usageWarning?: string }
  readonly meta: {
    readonly lastSuccessAt?: string
    readonly pendingBytes?: number
    readonly retryCount?: number
    readonly retryLabel?: string
    readonly errorMessage?: string
  }
  readonly isAnimating: boolean
  readonly isReadOnly: boolean
  readonly lastSavedAt?: string
  readonly banner?: AutoSaveIndicatorBanner
  readonly toast?: AutoSaveIndicatorToast
}

export interface DeriveAutoSaveIndicatorViewModelOptions {
  readonly snapshot: AutoSaveStatusSnapshot
  readonly historySummary?: AutoSaveHistorySummary
  readonly lockEvent?: ProjectLockEvent
  readonly lockState?: AutoSaveIndicatorLockState
}

export function deriveAutoSaveIndicatorViewModel({
  snapshot,
  historySummary,
  lockEvent,
  lockState
}: DeriveAutoSaveIndicatorViewModelOptions): AutoSaveIndicatorViewModel {
  const base = AUTOSAVE_PHASE_STATE_MAP[snapshot.phase]
  const retryLabel =
    snapshot.retryCount >= RETRY_LABEL_THRESHOLD ? `再試行中 (${snapshot.retryCount})` : undefined

  const effectiveLockEvent = lockState?.lastEvent ?? lockEvent
  const isReadOnly =
    lockState?.mode === 'readonly' || effectiveLockEvent?.type === 'lock:readonly-entered'
  const statusLabel = (() => {
    if (isReadOnly) {
      return READONLY_STATUS_LABEL
    }
    if (snapshot.lastError?.retryable === false) {
      return '自動保存を停止しました'
    }
    if (snapshot.phase === 'error') {
      return '自動保存エラー'
    }
    return retryLabel ?? base.label
  })()
  const isAnimating = ANIMATING_PHASES.has(snapshot.phase) && !isReadOnly
  const lastSavedAt = snapshot.lastSuccessAt

  const historyUsage = (() => {
    if (!historySummary || base.history.access === 'hidden') {
      return undefined
    }
    const generationsRatio = historySummary.maxGenerations
      ? historySummary.totalGenerations / historySummary.maxGenerations
      : 0
    const bytesRatio = historySummary.maxBytes ? historySummary.totalBytes / historySummary.maxBytes : 0
    if (historySummary.overflowDetected || historySummary.totalGenerations >= historySummary.maxGenerations) {
      return '履歴の世代数が上限に達しました。古い履歴から順に削除されます。'
    }
    if (bytesRatio >= 1 || historySummary.totalBytes >= historySummary.maxBytes) {
      return '履歴の保存容量が上限に達しました。自動で容量調整を実行しています。'
    }
    if (generationsRatio >= HISTORY_USAGE_WARNING_RATIO || bytesRatio >= HISTORY_USAGE_WARNING_RATIO) {
      return '履歴の利用率が 90% を超えています。不要な世代を整理してください。'
    }
    return undefined
  })()

  const banner = (() => {
    if (isReadOnly) {
      const readonlyReason = lockState?.reason
      const resolvedReason = readonlyReason ??
        (effectiveLockEvent?.type === 'lock:readonly-entered' ? effectiveLockEvent.reason : undefined)
      const reasonLabel =
        resolvedReason === 'acquire-failed'
          ? '他のタブが編集しています'
          : resolvedReason === 'renew-failed'
          ? 'ロック更新に失敗しました'
          : resolvedReason === 'release-failed'
          ? 'ロック解放に失敗しました'
          : 'ロック状態を確認してください'
      return {
        variant: 'warning' as const,
        message: `閲覧専用モードに切り替わりました（${reasonLabel}）。 復元・再試行の前にタブの状態を確認してください。`
      }
    }
    if (snapshot.phase === 'error' && snapshot.lastError && !snapshot.lastError.retryable) {
      return {
        variant: 'error' as const,
        message: `自動保存を停止しました: ${snapshot.lastError.message}`
      }
    }
    return undefined
  })()

  const toast = (() => {
    if (snapshot.lastError && snapshot.lastError.retryable) {
      return { variant: 'warning' as const, message: `自動保存の再試行に失敗しました（${snapshot.lastError.message}）` }
    }
    if (snapshot.retryCount >= RETRY_LABEL_THRESHOLD && snapshot.phase === 'awaiting-lock') {
      return { variant: 'warning' as const, message: `ロック取得を再試行中です (${snapshot.retryCount})` }
    }
    return undefined
  })()

  return {
    statusLabel,
    label: statusLabel,
    description: base.description,
    indicator: banner?.variant === 'error' ? 'error' : isReadOnly ? 'warning' : base.indicator,
    history: { ...base.history, usageWarning: historyUsage },
    meta: {
      lastSuccessAt: snapshot.lastSuccessAt,
      pendingBytes: snapshot.pendingBytes,
      retryCount: snapshot.retryCount || undefined,
      retryLabel,
      errorMessage: snapshot.lastError?.message
    },
    isAnimating,
    isReadOnly,
    lastSavedAt,
    banner,
    toast
  }
}

export interface AutoSaveIndicatorProps {
  readonly snapshot: AutoSaveStatusSnapshot
  readonly historySummary?: AutoSaveHistorySummary
  readonly lockEvent?: ProjectLockEvent
  readonly onToast?: (toast: AutoSaveIndicatorToast) => void
  readonly onOpenHistory?: () => void
  readonly historyButtonLabel?: string
}

function AutoSaveIndicatorComponent({
  snapshot,
  historySummary,
  lockEvent,
  onToast,
  onOpenHistory,
  historyButtonLabel = '履歴を開く'
}: AutoSaveIndicatorProps): ReactElement {
  const viewModel = useMemo(
    () => deriveAutoSaveIndicatorViewModel({ snapshot, historySummary, lockEvent }),
    [snapshot, historySummary, lockEvent]
  )

  useEffect(() => {
    if (onToast && viewModel.toast) {
      onToast(viewModel.toast)
    }
  }, [onToast, viewModel.toast])

  const historyButtonDisabled = viewModel.history.access !== 'available'

  return (
    <div
      className="autosave-indicator"
      role="status"
      aria-live={viewModel.indicator === 'error' ? 'assertive' : 'polite'}
      aria-busy={viewModel.isAnimating}
      data-phase={snapshot.phase}
      data-readonly={viewModel.isReadOnly ? 'true' : 'false'}
      data-animating={viewModel.isAnimating ? 'true' : 'false'}
    >
      {viewModel.banner ? (
        <div className={`autosave-indicator__banner autosave-indicator__banner--${viewModel.banner.variant}`} role="alert">
          {viewModel.banner.message}
        </div>
      ) : null}
      <div className="autosave-indicator__primary">
        <span className={`autosave-indicator__state autosave-indicator__state--${viewModel.indicator}`}>
          {viewModel.label}
        </span>
        <span className="autosave-indicator__description">{viewModel.description}</span>
      </div>
      <dl className="autosave-indicator__meta">
        {viewModel.meta.lastSuccessAt ? (
          <div>
            <dt>最終保存</dt>
            <dd>{viewModel.meta.lastSuccessAt}</dd>
          </div>
        ) : null}
        {viewModel.meta.pendingBytes ? (
          <div>
            <dt>保留中サイズ</dt>
            <dd>{`${viewModel.meta.pendingBytes} bytes`}</dd>
          </div>
        ) : null}
        {viewModel.meta.retryCount ? (
          <div>
            <dt>再試行回数</dt>
            <dd>{viewModel.meta.retryCount}</dd>
          </div>
        ) : null}
        {viewModel.meta.retryLabel ? (
          <div>
            <dt>状態</dt>
            <dd>{viewModel.meta.retryLabel}</dd>
          </div>
        ) : null}
        {viewModel.meta.errorMessage ? (
          <div className="autosave-indicator__error">
            <dt>エラー</dt>
            <dd>{viewModel.meta.errorMessage}</dd>
          </div>
        ) : null}
        {historySummary ? (
          <div>
            <dt>履歴利用状況</dt>
            <dd>
              {`${historySummary.totalGenerations}/${historySummary.maxGenerations} 世代・${historySummary.totalBytes}/${historySummary.maxBytes} bytes`}
            </dd>
          </div>
        ) : null}
      </dl>
      {viewModel.history.usageWarning ? (
        <p className="autosave-indicator__history-warning" role="alert">
          {viewModel.history.usageWarning}
        </p>
      ) : null}
      {onOpenHistory && viewModel.history.access !== 'hidden' ? (
        <button
          type="button"
          className="autosave-indicator__history"
          onClick={onOpenHistory}
          disabled={historyButtonDisabled}
          aria-disabled={historyButtonDisabled}
        >
          {historyButtonLabel}
        </button>
      ) : null}
      <p className="autosave-indicator__history-note">{viewModel.history.note}</p>
    </div>
  )
}

export const AutoSaveIndicator = memo(AutoSaveIndicatorComponent)

export type AutoSaveIndicatorTelemetryEvent =
  | {
      readonly type: 'phase-changed'
      readonly from: AutoSavePhase
      readonly to: AutoSavePhase
      readonly retryCount: number
    }
  | {
      readonly type: 'error-shown'
      readonly code: AutoSaveErrorCode
      readonly retryable: boolean
      readonly phase: AutoSavePhase
    }
  | {
      readonly type: 'retrying-started'
      readonly phase: AutoSavePhase
      readonly retryCount: number
    }
  | {
      readonly type: 'readonly-entered'
      readonly reason: ProjectLockReadonlyReason
    }

export interface AutoSaveIndicatorControllerState {
  readonly snapshot: AutoSaveStatusSnapshot
  readonly lockState: AutoSaveIndicatorLockState
  readonly viewModel: AutoSaveIndicatorViewModel
  readonly mergePrecision: MergePrecision
  readonly isVisible: boolean
  readonly telemetry: readonly AutoSaveIndicatorTelemetryEvent[]
}

export interface AutoSaveIndicatorControllerOptions {
  readonly snapshot: () => AutoSaveStatusSnapshot
  readonly subscribeLockEvents: (listener: (event: ProjectLockEvent) => void) => () => void
  readonly getHistorySummary?: () => AutoSaveHistorySummary | undefined
  readonly mergePrecision: MergePrecision
  readonly pollIntervalMs?: number
}

export interface AutoSaveIndicatorController {
  readonly store: StoreApi<AutoSaveIndicatorControllerState>
  start(): void
  dispose(): void
  flushTelemetry(): readonly AutoSaveIndicatorTelemetryEvent[]
  setMergePrecision(precision: MergePrecision): void
}

const INITIAL_LOCK_STATE: AutoSaveIndicatorLockState = Object.freeze({
  mode: 'unlocked' as const,
  since: 0
})

export function createAutoSaveIndicatorController({
  snapshot: snapshotFn,
  subscribeLockEvents,
  getHistorySummary,
  mergePrecision,
  pollIntervalMs = 250
}: AutoSaveIndicatorControllerOptions): AutoSaveIndicatorController {
  const initialSnapshot = snapshotFn()
  const initialLockState: AutoSaveIndicatorLockState = {
    ...INITIAL_LOCK_STATE,
    since: Date.now()
  }
  const initialViewModel = deriveAutoSaveIndicatorViewModel({
    snapshot: initialSnapshot,
    historySummary: getHistorySummary?.(),
    lockState: initialLockState
  })
  const initialState: AutoSaveIndicatorControllerState = {
    snapshot: initialSnapshot,
    lockState: initialLockState,
    viewModel: initialViewModel,
    mergePrecision,
    isVisible: shouldRenderIndicator(mergePrecision, initialSnapshot.phase),
    telemetry: []
  }

  const store = createStore<AutoSaveIndicatorControllerState>(() => initialState)
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let unsubscribeLock: () => void = () => {}
  let retryingTelemetryEmitted = false

  const commitSnapshot = (nextSnapshot: AutoSaveStatusSnapshot) => {
    const prev = store.getState()
    const telemetry: AutoSaveIndicatorTelemetryEvent[] = []

    if (prev.snapshot.phase !== nextSnapshot.phase) {
      telemetry.push({
        type: 'phase-changed',
        from: prev.snapshot.phase,
        to: nextSnapshot.phase,
        retryCount: nextSnapshot.retryCount
      })
    }
    if (nextSnapshot.lastError) {
      const prevError = prev.snapshot.lastError
      if (!prevError || prevError.code !== nextSnapshot.lastError.code || prevError.message !== nextSnapshot.lastError.message) {
        telemetry.push({
          type: 'error-shown',
          code: nextSnapshot.lastError.code,
          retryable: nextSnapshot.lastError.retryable,
          phase: nextSnapshot.phase
        })
      }
    }

    if (nextSnapshot.phase === 'awaiting-lock' && nextSnapshot.retryCount > 0) {
      if (!retryingTelemetryEmitted) {
        telemetry.push({
          type: 'retrying-started',
          phase: nextSnapshot.phase,
          retryCount: nextSnapshot.retryCount
        })
      }
      retryingTelemetryEmitted = true
    } else if (retryingTelemetryEmitted) {
      retryingTelemetryEmitted = false
    }

    const nextViewModel = deriveAutoSaveIndicatorViewModel({
      snapshot: nextSnapshot,
      historySummary: getHistorySummary?.(),
      lockState: prev.lockState
    })
    const viewModelChanged = !isViewModelEqual(prev.viewModel, nextViewModel)
    const snapshotChanged = !isSnapshotEqual(prev.snapshot, nextSnapshot)
    const nextVisible = shouldRenderIndicator(prev.mergePrecision, nextSnapshot.phase)
    const visibleChanged = nextVisible !== prev.isVisible

    if (!snapshotChanged && !viewModelChanged && !visibleChanged && telemetry.length === 0) {
      return
    }

    store.setState((state) => ({
      ...state,
      snapshot: snapshotChanged ? nextSnapshot : state.snapshot,
      viewModel: viewModelChanged ? nextViewModel : state.viewModel,
      isVisible: visibleChanged ? nextVisible : state.isVisible,
      telemetry: telemetry.length ? [...state.telemetry, ...telemetry] : state.telemetry
    }))
  }

  const commitLockEvent = (event: ProjectLockEvent) => {
    const prev = store.getState()
    const nextLockState = reduceLockState(prev.lockState, event)
    const telemetry: AutoSaveIndicatorTelemetryEvent[] = []

    if (prev.lockState.mode !== 'readonly' && nextLockState.mode === 'readonly' && nextLockState.reason) {
      telemetry.push({ type: 'readonly-entered', reason: nextLockState.reason })
    }

    const lockChanged = !isLockStateEqual(prev.lockState, nextLockState)
    if (!lockChanged && telemetry.length === 0) {
      return
    }

    const nextViewModel = deriveAutoSaveIndicatorViewModel({
      snapshot: prev.snapshot,
      historySummary: getHistorySummary?.(),
      lockState: nextLockState
    })
    const viewModelChanged = !isViewModelEqual(prev.viewModel, nextViewModel)

    store.setState((state) => ({
      ...state,
      lockState: nextLockState,
      viewModel: viewModelChanged ? nextViewModel : state.viewModel,
      telemetry: telemetry.length ? [...state.telemetry, ...telemetry] : state.telemetry
    }))
  }

  const poll = () => {
    commitSnapshot(snapshotFn())
  }

  const start = () => {
    if (pollTimer !== null) {
      return
    }
    poll()
    pollTimer = setInterval(poll, pollIntervalMs)
  }

  unsubscribeLock = subscribeLockEvents((event) => {
    commitLockEvent(event)
  })

  const dispose = () => {
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    unsubscribeLock()
    unsubscribeLock = () => {}
  }

  const flushTelemetry = (): readonly AutoSaveIndicatorTelemetryEvent[] => {
    const { telemetry } = store.getState()
    if (!telemetry.length) {
      return telemetry
    }
    store.setState((state) => ({ ...state, telemetry: [] }))
    return telemetry
  }

  const setMergePrecision = (precision: MergePrecision) => {
    const prev = store.getState()
    if (prev.mergePrecision === precision) {
      return
    }
    const nextVisible = shouldRenderIndicator(precision, prev.snapshot.phase)
    store.setState((state) => ({
      ...state,
      mergePrecision: precision,
      isVisible: nextVisible
    }))
  }

  start()

  return {
    store,
    start,
    dispose,
    flushTelemetry,
    setMergePrecision
  }
}

/**
 * `merge.precision` が `legacy` の間は AutoSaveIndicator を露出しない。
 * Phase B 以降（`beta`/`stable`）で有効化し、`phase='disabled'` 中は描画を抑止する。
 */
function shouldRenderIndicator(precision: MergePrecision, phase: AutoSavePhase): boolean {
  return precision !== 'legacy' && phase !== 'disabled'
}

function reduceLockState(
  prev: AutoSaveIndicatorLockState,
  event: ProjectLockEvent
): AutoSaveIndicatorLockState {
  switch (event.type) {
    case 'lock:readonly-entered':
      return { mode: 'readonly', reason: event.reason, lastEvent: event, since: Date.now() }
    case 'lock:acquired':
    case 'lock:renewed':
    case 'lock:renew-scheduled':
    case 'lock:fallback-engaged':
      return { mode: 'exclusive', lastEvent: event, since: Date.now() }
    case 'lock:released':
      return { mode: 'unlocked', lastEvent: event, since: Date.now() }
    case 'lock:error':
      return {
        mode: prev.mode === 'readonly' ? 'readonly' : 'unlocked',
        reason: prev.reason,
        lastEvent: event,
        since: Date.now()
      }
    default:
      return { ...prev, lastEvent: event }
  }
}

function isLockStateEqual(a: AutoSaveIndicatorLockState, b: AutoSaveIndicatorLockState): boolean {
  return (
    a.mode === b.mode &&
    a.reason === b.reason &&
    (a.lastEvent?.type ?? null) === (b.lastEvent?.type ?? null)
  )
}

function isSnapshotEqual(a: AutoSaveStatusSnapshot, b: AutoSaveStatusSnapshot): boolean {
  const errorKey = (input?: AutoSaveStatusSnapshot['lastError']) =>
    input ? `${input.code}:${input.retryable}:${input.message ?? ''}` : 'none'
  return (
    a.phase === b.phase &&
    a.lastSuccessAt === b.lastSuccessAt &&
    (a.pendingBytes ?? 0) === (b.pendingBytes ?? 0) &&
    a.retryCount === b.retryCount &&
    (a.queuedGeneration ?? null) === (b.queuedGeneration ?? null) &&
    errorKey(a.lastError) === errorKey(b.lastError)
  )
}

function isViewModelEqual(a: AutoSaveIndicatorViewModel, b: AutoSaveIndicatorViewModel): boolean {
  if (a === b) {
    return true
  }
  return (
    a.statusLabel === b.statusLabel &&
    a.description === b.description &&
    a.indicator === b.indicator &&
    a.isAnimating === b.isAnimating &&
    a.isReadOnly === b.isReadOnly &&
    a.lastSavedAt === b.lastSavedAt &&
    a.history.access === b.history.access &&
    a.history.note === b.history.note &&
    a.history.usageWarning === b.history.usageWarning &&
    a.meta.lastSuccessAt === b.meta.lastSuccessAt &&
    a.meta.pendingBytes === b.meta.pendingBytes &&
    a.meta.retryCount === b.meta.retryCount &&
    a.meta.retryLabel === b.meta.retryLabel &&
    a.meta.errorMessage === b.meta.errorMessage &&
    (a.banner?.variant ?? null) === (b.banner?.variant ?? null) &&
    (a.banner?.message ?? null) === (b.banner?.message ?? null) &&
    (a.toast?.variant ?? null) === (b.toast?.variant ?? null) &&
    (a.toast?.message ?? null) === (b.toast?.message ?? null)
  )
}

export interface AutoSaveIndicatorTestCase {
  readonly id: string
  readonly focus: 'view-model' | 'events'
  readonly description: string
  readonly assertions: readonly string[]
}

export const AUTO_SAVE_INDICATOR_TEST_PLAN: readonly AutoSaveIndicatorTestCase[] = Object.freeze([
  {
    id: 'VM-001',
    focus: 'view-model',
    description: 'idle → 保存完了スナップショットで statusLabel と lastSavedAt が更新される',
    assertions: ['statusLabel=最新状態', 'lastSavedAt が snapshot.lastSuccessAt に一致']
  },
  {
    id: 'VM-002',
    focus: 'view-model',
    description: 'awaiting-lock + retryCount>=1 で isAnimating=true かつ retryLabel 表示',
    assertions: ['isAnimating=true', 'meta.retryLabel に再試行文言を表示']
  },
  {
    id: 'VM-003',
    focus: 'view-model',
    description: 'lock:readonly-entered イベントで isReadOnly とバナーが警告表示になる',
    assertions: ['isReadOnly=true', 'banner.variant=warning']
  },
  {
    id: 'EV-001',
    focus: 'events',
    description: 'awaiting-lock リトライ開始で telemetry retrying-started を 1 回発行する',
    assertions: ['flushTelemetry() が retrying-started を返し、同フェーズ継続中は追加発行しない']
  },
  {
    id: 'EV-002',
    focus: 'events',
    description: 'merge.precision=legacy では isVisible=false を維持する',
    assertions: ['setMergePrecision("legacy") 後も isVisible=false', 'precision 昇格で true に遷移']
  }
])

export interface AutoSaveIndicatorTelemetryPolicyEvent {
  readonly type: AutoSaveIndicatorTelemetryEvent['type']
  readonly trigger: string
  readonly dedupeKey: 'phase' | 'retry' | 'reason'
}

export interface AutoSaveIndicatorTelemetryPolicy {
  readonly emitter: 'state-controller'
  readonly notes: readonly string[]
  readonly events: readonly AutoSaveIndicatorTelemetryPolicyEvent[]
}

export const AUTO_SAVE_INDICATOR_TELEMETRY_POLICY = {
  emitter: 'state-controller' as const,
  notes: [
    'Collector 連携は flushTelemetry() の戻り値を呼び出し元が処理することで UI コンポーネントと分離する',
    'retrying-started は `awaiting-lock` フェーズ継続中 1 度のみ発火し、フェーズ離脱でリセットする',
    'readonly-entered は ProjectLockReadonlyReason 単位で Collector 側へ伝播する'
  ] as const,
  events: [
    { type: 'phase-changed', trigger: 'snapshot() 更新', dedupeKey: 'phase' },
    { type: 'error-shown', trigger: 'snapshot().lastError 変化', dedupeKey: 'phase' },
    { type: 'retrying-started', trigger: 'awaiting-lock で retryCount>0', dedupeKey: 'retry' },
    { type: 'readonly-entered', trigger: 'lock:readonly-entered', dedupeKey: 'reason' }
  ] as const
} satisfies AutoSaveIndicatorTelemetryPolicy

export const AUTO_SAVE_INDICATOR_VIEW_MODEL_GRAPH = `mermaid
stateDiagram-v2
    [*] --> Disabled: phase='disabled'
    Disabled --> Idle: autosave enabled
    Idle --> Debouncing: change event
    Debouncing --> AwaitingLock: idle>=2s
    AwaitingLock --> Writing: phase in {'writing-current','updating-index'}
    Writing --> Gc: phase='gc'
    Gc --> Idle: gc-complete
    AwaitingLock --> Error: AutoSaveError
    Error --> Idle: retry success
    Error --> Disabled: retryable=false
    Idle --> ReadOnly: lock:readonly-entered
    ReadOnly --> Idle: lock reacquired
`
