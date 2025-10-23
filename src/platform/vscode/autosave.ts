import type {
  AutoSaveBridgeMessage,
  AutoSavePhase,
  AutoSavePhaseGuardSnapshot,
  AutoSaveSnapshotRequestMessage,
  AutoSaveSnapshotResultMessage,
  AutoSaveSnapshotResultPayload,
  AutoSaveStatusMessage,
  AutoSaveStatusState,
  AutoSavePolicy,
  AutoSaveError
} from '../../lib/autosave'

const toIso = (input: Date): string => input.toISOString()

const isGuardEnabled = (guard: AutoSavePhaseGuardSnapshot): boolean => guard.featureFlag.value && !guard.optionsDisabled

const createDisabledError = (): AutoSaveError => ({
  name: 'AutoSaveError',
  message: 'AutoSave is disabled by phase guard',
  code: 'disabled',
  retryable: false
})

export interface AutoSaveTelemetryEvent {
  readonly name: string
  readonly properties?: Record<string, unknown>
}

export interface AutoSaveWarnEvent {
  readonly code: string
  readonly details?: Record<string, unknown>
}

export interface AutoSaveAtomicWriteInput {
  readonly request: AutoSaveSnapshotRequestMessage
  readonly retainedBytes: number
  readonly historyEntries: number
}

export type AutoSaveAtomicWriteResult =
  | {
      readonly ok: true
      readonly bytes: number
      readonly generation: number
      readonly lastSuccessAt: string
      readonly lockStrategy: 'web-lock' | 'file-lock'
    }
  | {
      readonly ok: false
      readonly error: AutoSaveError
    }

export interface AutoSaveHostBridgeOptions {
  readonly policy: AutoSavePolicy
  readonly initialGuard: AutoSavePhaseGuardSnapshot
  readonly now: () => Date
  readonly sendMessage: (message: AutoSaveBridgeMessage) => void
  readonly atomicWrite: (input: AutoSaveAtomicWriteInput) => Promise<AutoSaveAtomicWriteResult>
  readonly telemetry?: (event: AutoSaveTelemetryEvent) => void
  readonly warn?: (event: AutoSaveWarnEvent) => void
}

export interface AutoSaveHostHistorySnapshot {
  readonly retainedBytes: number
  readonly generations: number
}

export interface AutoSaveHostStateSnapshot {
  readonly lastSuccessAt?: string
  readonly retryCount: number
  readonly status: AutoSaveStatusState
  readonly guard: AutoSavePhaseGuardSnapshot
}

export interface AutoSaveHostBridge {
  readonly reportDirty: (pendingBytes: number, guard: AutoSavePhaseGuardSnapshot) => void
  readonly handleSnapshotRequest: (request: AutoSaveSnapshotRequestMessage) => Promise<void>
  readonly inspectHistory: () => AutoSaveHostHistorySnapshot
  readonly inspectState: () => AutoSaveHostStateSnapshot
}

interface HistoryEntry {
  readonly generation: number
  readonly bytes: number
}

interface InternalState {
  guard: AutoSavePhaseGuardSnapshot
  lastSuccessAt?: string
  retryCount: number
  status: AutoSaveStatusState
  reqCounter: number
  history: HistoryEntry[]
  retainedBytes: number
}

const sumBytes = (entries: readonly HistoryEntry[]): number => entries.reduce((acc, entry) => acc + entry.bytes, 0)

const statusPhaseForState = (state: AutoSaveStatusState): AutoSavePhase => {
  switch (state) {
    case 'disabled':
      return 'disabled'
    case 'dirty':
      return 'debouncing'
    case 'saving':
      return 'awaiting-lock'
    case 'saved':
      return 'idle'
    case 'error':
      return 'error'
    case 'backoff':
      return 'awaiting-lock'
  }
}

const createStatusMessage = (
  reqId: string,
  issuedAt: string,
  state: AutoSaveStatusState,
  guard: AutoSavePhaseGuardSnapshot,
  retryCount: number,
  lastSuccessAt: string | undefined,
  pendingBytes?: number
): AutoSaveStatusMessage => ({
  type: 'status.autosave',
  phase: 'status.autosave',
  reqId,
  issuedAt,
  payload: {
    state,
    phase: statusPhaseForState(state),
    retryCount,
    lastSuccessAt,
    pendingBytes,
    guard
  }
})

const createSnapshotResultMessage = (
  request: AutoSaveSnapshotRequestMessage,
  issuedAt: string,
  payload: AutoSaveSnapshotResultPayload
): AutoSaveSnapshotResultMessage => ({
  type: 'snapshot.result',
  phase: 'snapshot.result',
  reqId: request.reqId,
  issuedAt,
  payload
})

const clampHistory = (state: InternalState, policy: AutoSavePolicy): void => {
  const entries = [...state.history]
  while (entries.length > policy.maxGenerations) entries.shift()
  let retained = sumBytes(entries)
  while (retained > policy.maxBytes && entries.length > 0) {
    entries.shift()
    retained = sumBytes(entries)
  }
  state.history = entries
  state.retainedBytes = retained
}

const emitTelemetry = (options: AutoSaveHostBridgeOptions, event: AutoSaveTelemetryEvent): void => {
  options.telemetry?.(event)
}

const emitWarn = (options: AutoSaveHostBridgeOptions, event: AutoSaveWarnEvent): void => {
  options.warn?.(event)
}

const nextReqId = (state: InternalState): string => `autosave-${++state.reqCounter}`

const handleNonRetryableError = (
  options: AutoSaveHostBridgeOptions,
  state: InternalState,
  request: AutoSaveSnapshotRequestMessage,
  error: AutoSaveError
): void => {
  state.status = 'error'
  state.retryCount = 0
  const issuedAt = toIso(options.now())
  options.sendMessage(
    createSnapshotResultMessage(request, issuedAt, { ok: false, error })
  )
  emitTelemetry(options, {
    name: 'autosave.snapshot.result',
    properties: { ok: false, code: error.code, retryable: error.retryable }
  })
  options.sendMessage(
    createStatusMessage(request.reqId, issuedAt, 'error', state.guard, state.retryCount, state.lastSuccessAt)
  )
  state.status = 'disabled'
  state.guard = {
    featureFlag: state.guard.featureFlag,
    optionsDisabled: true
  }
  options.sendMessage(
    createStatusMessage(request.reqId, issuedAt, 'disabled', state.guard, state.retryCount, state.lastSuccessAt)
  )
}

export const createVscodeAutoSaveBridge = (options: AutoSaveHostBridgeOptions): AutoSaveHostBridge => {
  const state: InternalState = {
    guard: options.initialGuard,
    lastSuccessAt: undefined,
    retryCount: 0,
    status: 'disabled',
    reqCounter: 0,
    history: [],
    retainedBytes: 0
  }

  const reportDirty = (pendingBytes: number, guard: AutoSavePhaseGuardSnapshot): void => {
    state.guard = guard
    const issuedAt = toIso(options.now())
    if (!isGuardEnabled(guard)) {
      state.status = 'disabled'
      state.retryCount = 0
      options.sendMessage(createStatusMessage(nextReqId(state), issuedAt, 'disabled', guard, state.retryCount, state.lastSuccessAt))
      emitTelemetry(options, {
        name: 'autosave.status',
        properties: { state: 'disabled', source: 'phase-guard' }
      })
      return
    }
    state.status = 'dirty'
    const reqId = nextReqId(state)
    options.sendMessage(createStatusMessage(reqId, issuedAt, 'dirty', guard, state.retryCount, state.lastSuccessAt, pendingBytes))
    emitTelemetry(options, {
      name: 'autosave.status',
      properties: { state: 'dirty', pendingBytes }
    })
  }

  const handleSnapshotRequest = async (request: AutoSaveSnapshotRequestMessage): Promise<void> => {
    state.guard = request.payload.guard
    const issuedAt = toIso(options.now())
    if (!isGuardEnabled(state.guard)) {
      state.status = 'disabled'
      options.sendMessage(
        createSnapshotResultMessage(request, issuedAt, { ok: false, error: createDisabledError() })
      )
      emitTelemetry(options, {
        name: 'autosave.snapshot.result',
        properties: { ok: false, code: 'disabled', retryable: false }
      })
      options.sendMessage(createStatusMessage(request.reqId, issuedAt, 'disabled', state.guard, state.retryCount, state.lastSuccessAt))
      return
    }

    state.status = 'saving'
    state.retryCount = 0
    options.sendMessage(
      createStatusMessage(
        request.reqId,
        issuedAt,
        'saving',
        state.guard,
        state.retryCount,
        state.lastSuccessAt,
        request.payload.pendingBytes
      )
    )
    emitTelemetry(options, {
      name: 'autosave.status',
      properties: { state: 'saving', reqId: request.reqId }
    })

    let writeResult: AutoSaveAtomicWriteResult
    try {
      writeResult = await options.atomicWrite({
        request,
        retainedBytes: state.retainedBytes,
        historyEntries: state.history.length
      })
    } catch (rawError) {
      const error: AutoSaveError = {
        name: 'AutoSaveError',
        message: rawError instanceof Error ? rawError.message : String(rawError),
        code: 'write-failed',
        retryable: false,
        cause: rawError instanceof Error ? rawError : undefined
      }
      handleNonRetryableError(options, state, request, error)
      return
    }

    if (!writeResult.ok) {
      if (writeResult.error.retryable) {
        state.status = 'backoff'
        state.retryCount += 1
        const retryIssuedAt = toIso(options.now())
        options.sendMessage(createSnapshotResultMessage(request, retryIssuedAt, writeResult))
        options.sendMessage(
          createStatusMessage(request.reqId, retryIssuedAt, 'backoff', state.guard, state.retryCount, state.lastSuccessAt)
        )
        emitTelemetry(options, {
          name: 'autosave.snapshot.result',
          properties: { ok: false, code: writeResult.error.code, retryable: true }
        })
        return
      }
      handleNonRetryableError(options, state, request, writeResult.error)
      return
    }

    if (writeResult.lockStrategy === 'file-lock') {
      emitWarn(options, {
        code: 'autosave.lock.fallback',
        details: { reqId: request.reqId, strategy: writeResult.lockStrategy }
      })
    }

    state.history = [...state.history, { generation: writeResult.generation, bytes: writeResult.bytes }]
    clampHistory(state, options.policy)
    state.lastSuccessAt = writeResult.lastSuccessAt
    state.status = 'saved'
    state.retryCount = 0

    const successIssuedAt = toIso(options.now())
    const payload: AutoSaveSnapshotResultPayload = {
      ok: true,
      bytes: writeResult.bytes,
      lastSuccessAt: state.lastSuccessAt,
      generation: writeResult.generation,
      retainedBytes: state.retainedBytes
    }
    options.sendMessage(createSnapshotResultMessage(request, successIssuedAt, payload))
    emitTelemetry(options, {
      name: 'autosave.snapshot.result',
      properties: { ok: true, generation: writeResult.generation, retainedBytes: state.retainedBytes }
    })
    options.sendMessage(
      createStatusMessage(request.reqId, successIssuedAt, 'saved', state.guard, state.retryCount, state.lastSuccessAt)
    )
    emitTelemetry(options, {
      name: 'autosave.status',
      properties: { state: 'saved', reqId: request.reqId }
    })
  }

  const inspectHistory = (): AutoSaveHostHistorySnapshot => ({
    retainedBytes: state.retainedBytes,
    generations: state.history.length
  })

  const inspectState = (): AutoSaveHostStateSnapshot => ({
    lastSuccessAt: state.lastSuccessAt,
    retryCount: state.retryCount,
    status: state.status,
    guard: state.guard
  })

  if (isGuardEnabled(state.guard)) {
    state.status = 'idle'
  }

  return { reportDirty, handleSnapshotRequest, inspectHistory, inspectState }
}
