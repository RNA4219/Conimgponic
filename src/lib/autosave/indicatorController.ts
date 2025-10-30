import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'

import type { MergePrecision } from '../../config/flags'
import type { AutoSaveErrorCode, AutoSavePhase, AutoSaveStatusSnapshot } from '../autosave'
import type { ProjectLockEvent } from '../locks'
import {
  type AutoSaveHistorySummary,
  type AutoSaveIndicatorLockState,
  type AutoSaveIndicatorViewModel,
  deriveAutoSaveIndicatorViewModel,
  isViewModelEqual
} from './indicatorViewModel'

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
      readonly reason: NonNullable<AutoSaveIndicatorLockState['reason']>
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
