import { publishGuardCollectorEvent } from '../../lib/autosave'
import type {
  AutoSaveBridgeMessage,
  AutoSavePhaseGuardSnapshot,
  AutoSaveSnapshotRequestMessage,
  AutoSaveSnapshotResultPayload,
  AutoSaveStatusState,
  AutoSavePolicy
} from '../../lib/autosave'
import type { FlagSnapshot, WorkspaceConfiguration } from '../../config/index.js'
import { resolveAutoSaveBootstrapPlan } from '../../config/index.js'
import { deriveAutoSavePhaseGuard } from './flags/index.js'
import {
  createDisabledError,
  normalizeAtomicWriteError
} from './autosave/error.js'
import type {
  AutoSaveAtomicWriteInput,
  AutoSaveAtomicWriteResult,
  AutoSaveTelemetryEvent,
  AutoSaveTelemetryEventInput,
  AutoSaveWarnEvent,
} from './autosave/collector.js'
import {
  createFlushLatencyPerformance,
  createSnapshotFailureDetail,
  createSnapshotPayload,
  createSnapshotSuccessDetail,
  publishCollectorSnapshotResult,
  ZERO_FLUSH_LATENCY
} from './autosave/collector.js'
import {
  createBootstrapMessage,
  createBridgeReadyMessage,
  createSnapshotResultMessage,
  createStatusMessage,
  PHASE_SNAPSHOT,
  PHASE_STATUS,
  toIsoTimestamp
} from './autosave/bootstrap.js'
import { resolveSnapshotTelemetryPhase } from './autosave/guard.js'
import { formatTelemetryEvent, type AutoSaveTelemetryContext } from './autosave/telemetry.js'
import { emitWarn, handleNonRetryableError } from './autosave/errors.js'
import {
  clampHistory,
  computeFlushLatencyMs,
  computeLagSeconds,
  createInitialState,
  InternalState,
  isGuardEnabled,
  mergeGuard,
  nextCorrelationId,
  nextReqId,
  resolveGuardBlockedReason,
  statusPhaseForState
} from './autosave/state.js'

export type {
  AutoSaveAtomicWriteInput,
  AutoSaveAtomicWriteResult,
  AutoSaveTelemetryEvent,
  AutoSaveTelemetryEventInput,
  AutoSaveTelemetryEventProperties,
  AutoSaveTelemetryGuardProperties,
  AutoSaveTelemetryLockStrategy,
  AutoSaveWarnEvent,
  SnapshotResultCollectorPayload,
  SnapshotResultDetailPhase,
  SnapshotResultFailureDetailWithPhase,
  SnapshotResultSuccessDetailWithPhase
} from './autosave/collector.js'
export { resolveCollectorPhase } from '../../lib/autosave/collector-phase.js'
export { statusPhaseForState } from './autosave/state.js'

/**
 * Collector テレメトリに付与される拡張プロパティ。
 * Bridge 側で state 遷移の `phaseBefore`/`phaseAfter` と Guard/Lock メタデータを注入する。
 */
export interface AutoSaveHostBridgeOptions {
  readonly policy: AutoSavePolicy
  readonly initialGuard?: AutoSavePhaseGuardSnapshot
  readonly flags?: FlagSnapshot
  readonly workspace?: WorkspaceConfiguration | null
  readonly now: () => Date
  readonly sendMessage: (message: AutoSaveBridgeMessage) => void
  readonly atomicWrite: (input: AutoSaveAtomicWriteInput) => Promise<AutoSaveAtomicWriteResult>
  /**
   * Collector 向けテレメトリ転送。`properties` には state 遷移前後の `phaseBefore`/`phaseAfter`
   * と Guard 出典(`flagSource`)、ロック戦略(`lockStrategy` = `'web-lock' | 'file-lock' | 'none'`)
   * を常に含め、Phase ロールバック判定（docs/AUTOSAVE-DESIGN-IMPL.md §5）へ活用できる。
   */
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

const dispatchTelemetry = (
  options: AutoSaveHostBridgeOptions,
  event: AutoSaveTelemetryEventInput,
  context: AutoSaveTelemetryContext
): void => {
  if (!options.telemetry) {
    return
  }
  options.telemetry(formatTelemetryEvent(event, context))
}

const publishGuardBlockedCollectorEvent = (
  guard: AutoSavePhaseGuardSnapshot
): void => {
  publishGuardCollectorEvent(guard, resolveGuardBlockedReason(guard))
}

export const createVscodeAutoSaveBridge = (options: AutoSaveHostBridgeOptions): AutoSaveHostBridge => {
  let bootstrapFlags: FlagSnapshot
  let initialGuard: AutoSavePhaseGuardSnapshot

  if (options.flags) {
    bootstrapFlags = options.flags
    initialGuard = options.initialGuard ?? deriveAutoSavePhaseGuard(bootstrapFlags)
  } else {
    const plan = resolveAutoSaveBootstrapPlan(
      { workspace: options.workspace ?? null, clock: options.now },
      options.initialGuard
        ? { optionsDisabled: options.initialGuard.optionsDisabled }
        : undefined
    )
    bootstrapFlags = plan.snapshot
    initialGuard = options.initialGuard ?? plan.guard
  }

  const state: InternalState = createInitialState(initialGuard)
  const bootstrapReqId = nextReqId(state)
  const bootstrapCorrelationId = nextCorrelationId(state)
  const bootstrapTs = toIsoTimestamp(options.now)
  options.sendMessage(
    createBootstrapMessage(
      bootstrapReqId,
      bootstrapCorrelationId,
      bootstrapTs,
      options.policy,
      state.guard,
      bootstrapFlags
    )
  )

  const readyAccepted = isGuardEnabled(state.guard)
  const readyReason = readyAccepted ? undefined : resolveGuardBlockedReason(state.guard)
  const readyReqId = nextReqId(state)
  const readyCorrelationId = nextCorrelationId(state)
  options.sendMessage(
    createBridgeReadyMessage(
      readyReqId,
      readyCorrelationId,
      bootstrapTs,
      readyAccepted,
      readyReason
    )
  )

  const reportDirty = (pendingBytes: number, guard: AutoSavePhaseGuardSnapshot): void => {
    const previousStatus = state.status
    const shouldForceDisable = state.forceDisabled
    state.guard = mergeGuard(state.guard, guard, shouldForceDisable)
    const now = options.now()
    const nowMs = now.getTime()
    const ts = toIsoTimestamp(() => now)
    const correlationId = nextCorrelationId(state)
    const envelopePhase = PHASE_STATUS
    const latencyMs = computeFlushLatencyMs(state, nowMs)
    const flushLatency = createFlushLatencyPerformance(latencyMs)
    if (!isGuardEnabled(state.guard)) {
      state.status = 'disabled'
      state.retryCount = 0
      state.flushStartedAtMs = undefined
      options.sendMessage(
        createStatusMessage(
          nextReqId(state),
          correlationId,
          ts,
          envelopePhase,
          'disabled',
          state.guard,
          state.retryCount,
          state.lastSuccessAt
        )
      )
      const attempt = state.retryCount + 1
      const phaseStep = statusPhaseForState(state.status)
      dispatchTelemetry(
        options,
        {
          name: 'autosave.status',
          properties: {
            state: 'disabled',
            source: 'phase-guard',
            correlationId,
            retryCount: state.retryCount,
            phase: envelopePhase,
            performance: flushLatency,
            debounce_ms: options.policy.debounceMs,
            latency_ms: latencyMs,
            attempt,
            phase_step: phaseStep
          }
        },
        { before: previousStatus, after: state.status, guard: state.guard }
      )
      dispatchTelemetry(
        options,
        {
          name: 'autosave.guard',
          properties: {
            blocked: true,
            reason: resolveGuardBlockedReason(state.guard),
            source: 'phase-guard',
            correlationId
          }
        },
        { before: previousStatus, after: state.status, guard: state.guard }
      )
      publishGuardBlockedCollectorEvent(state.guard)
      return
    }
    state.status = 'dirty'
    const reqId = nextReqId(state)
    options.sendMessage(
      createStatusMessage(
        reqId,
        correlationId,
        ts,
        envelopePhase,
        'dirty',
        state.guard,
        state.retryCount,
        state.lastSuccessAt,
        pendingBytes
      )
    )
    const attempt = state.retryCount + 1
    const phaseStep = statusPhaseForState(state.status)
    dispatchTelemetry(
      options,
      {
        name: 'autosave.status',
        properties: {
          state: 'dirty',
          pendingBytes,
          correlationId,
          retryCount: state.retryCount,
          phase: envelopePhase,
          performance: flushLatency,
          debounce_ms: options.policy.debounceMs,
          latency_ms: latencyMs,
          attempt,
          phase_step: phaseStep
        }
      },
      { before: previousStatus, after: state.status, guard: state.guard }
    )
  }

  const handleSnapshotRequest = async (request: AutoSaveSnapshotRequestMessage): Promise<void> => {
    const statusBeforeRequest = state.status
    const incomingGuard = request.payload.guard
    const shouldForceDisable = state.forceDisabled
    const requestStartedAt = options.now()
    const requestStartedAtMs = requestStartedAt.getTime()
    const requestDebounceMs =
      typeof request.payload.debounceMs === 'number'
        ? request.payload.debounceMs
        : options.policy.debounceMs
    state.guard = mergeGuard(state.guard, incomingGuard, shouldForceDisable)
    const requestEnvelopePhase = request.phase ?? PHASE_SNAPSHOT
    const telemetryPhase = resolveSnapshotTelemetryPhase(state.guard, requestEnvelopePhase)
    const ts = toIsoTimestamp(() => requestStartedAt)
    if (!isGuardEnabled(state.guard)) {
      state.status = 'disabled'
      state.retryCount = 0
      const disabledLatencyMs = computeFlushLatencyMs(state, requestStartedAtMs)
      state.flushStartedAtMs = undefined
      const disabledError = createDisabledError()
      options.sendMessage(
        createSnapshotResultMessage(request, ts, { ok: false, error: disabledError })
      )
      const statusPhase = statusPhaseForState(state.status)
      publishCollectorSnapshotResult(request, state.guard, ts, {
        status: 'failure',
        detail: createSnapshotFailureDetail(
          0,
          state.retryCount,
          disabledError.retryable,
          disabledError.code,
          disabledError.message,
          computeLagSeconds(state.lastSuccessAt, ts),
          statusPhase
        )
      })
      dispatchTelemetry(
        options,
        {
          name: 'autosave.snapshot.result',
          properties: {
            ok: false,
            status: 'failure',
            code: 'disabled',
            retryable: false,
            correlationId: request.correlationId,
            retryCount: state.retryCount,
            phase: PHASE_STATUS,
            performance: ZERO_FLUSH_LATENCY,
            detail: { phase: statusPhase }
          }
        },
        { before: statusBeforeRequest, after: state.status, guard: state.guard }
      )
      options.sendMessage(
        createStatusMessage(
          request.reqId,
          request.correlationId,
          ts,
          PHASE_STATUS,
          'disabled',
          state.guard,
          state.retryCount,
          state.lastSuccessAt
        )
      )
      const attempt = state.retryCount + 1
      const phaseStep = statusPhaseForState(state.status)
      dispatchTelemetry(
        options,
        {
          name: 'autosave.status',
          properties: {
            state: 'disabled',
            correlationId: request.correlationId,
            retryCount: state.retryCount,
            phase: PHASE_STATUS,
            performance: ZERO_FLUSH_LATENCY,
            debounce_ms: requestDebounceMs,
            latency_ms: disabledLatencyMs,
            attempt,
            phase_step: phaseStep
          }
        },
        { before: statusBeforeRequest, after: state.status, guard: state.guard }
      )
      dispatchTelemetry(
        options,
        {
          name: 'autosave.guard',
          properties: {
            blocked: true,
            reason: resolveGuardBlockedReason(state.guard),
            source: 'phase-guard',
            correlationId: request.correlationId,
            reqId: request.reqId
          }
        },
        { before: statusBeforeRequest, after: state.status, guard: state.guard }
      )
      publishGuardBlockedCollectorEvent(state.guard)
      return
    }

    const statusBeforeSaving = state.status
    const retryCountBeforeSaving = state.retryCount
    state.status = 'saving'
    const shouldPreserveRetryCount =
      statusBeforeSaving === 'backoff' || retryCountBeforeSaving > 0
    state.retryCount = shouldPreserveRetryCount ? retryCountBeforeSaving : 0
    state.flushStartedAtMs = requestStartedAtMs
    options.sendMessage(
      createStatusMessage(
        request.reqId,
        request.correlationId,
        ts,
        requestEnvelopePhase,
        'saving',
        state.guard,
        state.retryCount,
        state.lastSuccessAt,
        request.payload.pendingBytes
      )
    )
    const savingLatencyMs = computeFlushLatencyMs(state, requestStartedAtMs)
    const savingAttempt = state.retryCount + 1
    const savingPhaseStep = statusPhaseForState(state.status)
    dispatchTelemetry(
      options,
      {
        name: 'autosave.status',
        properties: {
          state: 'saving',
          reqId: request.reqId,
          correlationId: request.correlationId,
          retryCount: state.retryCount,
          phase: telemetryPhase,
          performance: createFlushLatencyPerformance(savingLatencyMs),
          debounce_ms: requestDebounceMs,
          latency_ms: savingLatencyMs,
          attempt: savingAttempt,
          phase_step: savingPhaseStep
        }
      },
      { before: statusBeforeSaving, after: state.status, guard: state.guard }
    )

    let writeResult: AutoSaveAtomicWriteResult
    try {
      writeResult = await options.atomicWrite({
        request,
        retainedBytes: state.retainedBytes,
        historyEntries: state.history.length
      })
    } catch (rawError) {
      writeResult = { ok: false, error: normalizeAtomicWriteError(rawError) }
    }

    if (!writeResult.ok) {
      if (writeResult.error.retryable) {
        const statusBeforeBackoff = state.status
        state.status = 'backoff'
        state.retryCount += 1
        const retryTimestamp = options.now()
        const retryLatency = computeFlushLatencyMs(state, retryTimestamp.getTime())
        state.flushStartedAtMs = undefined
        const retryTs = toIsoTimestamp(() => retryTimestamp)
        options.sendMessage(createSnapshotResultMessage(request, retryTs, writeResult))
        const statusPhase = statusPhaseForState(state.status)
        publishCollectorSnapshotResult(request, state.guard, retryTs, {
          status: 'failure',
          detail: createSnapshotFailureDetail(
            retryLatency,
            state.retryCount,
            true,
            writeResult.error.code,
            writeResult.error.message,
            computeLagSeconds(state.lastSuccessAt, retryTs),
            statusPhase
          )
        })
        options.sendMessage(
          createStatusMessage(
            request.reqId,
            request.correlationId,
            retryTs,
            requestEnvelopePhase,
            'backoff',
            state.guard,
            state.retryCount,
            state.lastSuccessAt
          )
        )
        const backoffAttempt = state.retryCount + 1
        const backoffPhaseStep = statusPhaseForState(state.status)
        dispatchTelemetry(
          options,
          {
            name: 'autosave.status',
            properties: {
              state: 'backoff',
              correlationId: request.correlationId,
              retryCount: state.retryCount,
              phase: telemetryPhase,
              performance: createFlushLatencyPerformance(retryLatency),
              debounce_ms: requestDebounceMs,
              latency_ms: retryLatency,
              attempt: backoffAttempt,
              phase_step: backoffPhaseStep
            }
          },
          { before: statusBeforeBackoff, after: state.status, guard: state.guard }
        )
        dispatchTelemetry(
          options,
          {
            name: 'autosave.snapshot.result',
            properties: {
              ok: false,
              status: 'failure',
              code: writeResult.error.code,
              retryable: true,
              correlationId: request.correlationId,
              retryCount: state.retryCount,
              phase: telemetryPhase,
              performance: createFlushLatencyPerformance(retryLatency),
              detail: { phase: statusPhase }
            }
          },
          { before: statusBeforeBackoff, after: state.status, guard: state.guard }
        )
        return
      }
      handleNonRetryableError(
        {
          now: options.now,
          sendMessage: options.sendMessage,
          dispatchTelemetry: (event, context) => dispatchTelemetry(options, event, context),
          policy: options.policy
        },
        state,
        request,
        writeResult.error,
        state.status
      )
      return
    }

    if (writeResult.lockStrategy === 'file-lock') {
      emitWarn(options.warn, {
        code: 'autosave.lock.fallback',
        details: { reqId: request.reqId, strategy: writeResult.lockStrategy, correlationId: request.correlationId }
      })
    }

    const statusBeforeSuccess = state.status
    const retryCountForSnapshot = state.retryCount
    const previousLastSuccessAt = state.lastSuccessAt
    state.history = [...state.history, { generation: writeResult.generation, bytes: writeResult.bytes }]
    clampHistory(state, options.policy)
    state.lastSuccessAt = writeResult.lastSuccessAt
    state.status = 'saved'
    state.retryCount = 0

    const successTimestamp = options.now()
    const successLatency = computeFlushLatencyMs(state, successTimestamp.getTime())
    state.flushStartedAtMs = undefined
    const successTs = toIsoTimestamp(() => successTimestamp)
    const payload: AutoSaveSnapshotResultPayload = {
      ok: true,
      bytes: writeResult.bytes,
      lastSuccessAt: state.lastSuccessAt,
      generation: writeResult.generation,
      retainedBytes: state.retainedBytes
    }
    options.sendMessage(createSnapshotResultMessage(request, successTs, payload))
    const statusPhase = statusPhaseForState(state.status)
    const successDetail = createSnapshotSuccessDetail(
      successLatency,
      retryCountForSnapshot,
      computeLagSeconds(previousLastSuccessAt, successTs),
      statusPhase
    )
    const collectorSnapshot = createSnapshotPayload(
      writeResult.bytes,
      state.retainedBytes,
      writeResult.generation,
      state.lastSuccessAt,
      successTs
    )
    publishCollectorSnapshotResult(request, state.guard, successTs, {
      status: 'success',
      detail: successDetail,
      snapshot: collectorSnapshot
    })
    const savedAttempt = retryCountForSnapshot + 1
    const savedPhaseStep = statusPhaseForState(state.status)
    dispatchTelemetry(
      options,
      {
        name: 'autosave.snapshot.result',
        properties: {
          ok: true,
          status: 'success',
          generation: writeResult.generation,
          retainedBytes: state.retainedBytes,
          correlationId: request.correlationId,
          retryCount: retryCountForSnapshot,
          phase: telemetryPhase,
          performance: createFlushLatencyPerformance(successLatency),
          detail: { phase: statusPhase }
        }
      },
      { before: statusBeforeSuccess, after: state.status, guard: state.guard, lockStrategy: writeResult.lockStrategy }
    )
    options.sendMessage(
      createStatusMessage(
        request.reqId,
        request.correlationId,
        successTs,
        requestEnvelopePhase,
        'saved',
        state.guard,
        state.retryCount,
        state.lastSuccessAt,
        undefined,
        savedAttempt
      )
    )
    dispatchTelemetry(
      options,
      {
        name: 'autosave.status',
        properties: {
          state: 'saved',
          reqId: request.reqId,
          correlationId: request.correlationId,
          retryCount: state.retryCount,
          phase: telemetryPhase,
          performance: createFlushLatencyPerformance(successLatency),
          debounce_ms: requestDebounceMs,
          latency_ms: successLatency,
          attempt: savedAttempt,
          phase_step: savedPhaseStep
        }
      },
      { before: statusBeforeSuccess, after: state.status, guard: state.guard, lockStrategy: writeResult.lockStrategy }
    )
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
    state.status = 'saved'
  }

  return { reportDirty, handleSnapshotRequest, inspectHistory, inspectState }
}
