import type {
  AutoSaveBridgeBootstrapMessage,
  AutoSaveBridgeMessage,
  AutoSavePhase,
  AutoSaveEnvelopePhase,
  AutoSavePhaseGuardSnapshot,
  AutoSaveSnapshotRequestMessage,
  AutoSaveSnapshotResultMessage,
  AutoSaveSnapshotResultPayload,
  AutoSaveStatusMessage,
  AutoSaveStatusSnapshot,
  AutoSaveStatusState,
  AutoSavePolicy,
  AutoSaveError
} from '../../lib/autosave'
import { resolveFlags } from '../../config/index.js'
import type { FlagSnapshot, WorkspaceConfiguration } from '../../config/index.js'
import { publishSnapshotResult } from '../../telemetry/day8Collector.js'
import type {
  RolloutPhase,
  SnapshotResultFailureDetail,
  SnapshotResultSnapshot,
  SnapshotResultSuccessDetail
} from '../../../scripts/monitor/collect-metrics'

const toIso = (input: Date): string => input.toISOString()

const isGuardEnabled = (guard: AutoSavePhaseGuardSnapshot): boolean => guard.featureFlag.value && !guard.optionsDisabled

const mergeGuard = (
  _previous: AutoSavePhaseGuardSnapshot,
  incoming: AutoSavePhaseGuardSnapshot,
  forceDisabled: boolean
): AutoSavePhaseGuardSnapshot =>
  forceDisabled ? { featureFlag: incoming.featureFlag, optionsDisabled: true } : incoming

const resolveGuardBlockedReason = (
  guard: AutoSavePhaseGuardSnapshot
): 'feature-flag-disabled' | 'options-disabled' =>
  guard.featureFlag.value ? 'options-disabled' : 'feature-flag-disabled'

const createDisabledError = (): AutoSaveError => ({
  name: 'AutoSaveError',
  message: 'AutoSave is disabled by phase guard',
  code: 'disabled',
  retryable: false
})

const isAutoSaveError = (value: unknown): value is AutoSaveError => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as { name?: unknown; code?: unknown; retryable?: unknown }
  if (typeof candidate.code !== 'string' || typeof candidate.retryable !== 'boolean') {
    return false
  }
  return candidate.name === 'AutoSaveError' || candidate.name === 'Error'
}

const DOM_EXCEPTION_CTOR: typeof DOMException | undefined =
  typeof DOMException === 'undefined' ? undefined : DOMException

const asDomException = (value: unknown): DOMException | undefined => {
  if (!DOM_EXCEPTION_CTOR) {
    return undefined
  }
  return value instanceof DOM_EXCEPTION_CTOR ? (value as DOMException) : undefined
}

const normalizeAtomicWriteError = (rawError: unknown): AutoSaveError => {
  if (isAutoSaveError(rawError)) {
    return rawError
  }

  const domException = asDomException(rawError)
  if (domException) {
    const retryable = domException.name !== 'NotAllowedError'
    const context: Record<string, unknown> = {
      origin: 'bridge.atomicWrite',
      kind: 'dom-exception',
      name: domException.name
    }
    if (domException.message) {
      context.message = domException.message
    }
    return {
      name: 'AutoSaveError',
      message: domException.message,
      code: 'write-failed',
      retryable,
      cause: domException,
      context
    }
  }

  const cause = rawError instanceof Error ? rawError : undefined
  const message = cause?.message ?? String(rawError)
  const context: Record<string, unknown> = {
    origin: 'bridge.atomicWrite',
    kind: cause ? 'error' : 'unknown'
  }
  if (cause) {
    context.name = cause.name
  } else if (rawError !== null && typeof rawError === 'object') {
    const constructorName = (rawError as { constructor?: { name?: string } }).constructor?.name
    if (constructorName) {
      context.constructorName = constructorName
    }
  } else {
    context.value = rawError
  }

  return {
    name: 'AutoSaveError',
    message,
    code: 'write-failed',
    retryable: true,
    ...(cause ? { cause } : {}),
    context
  }
}

type AutoSaveTelemetryLockStrategy = Extract<
  AutoSaveAtomicWriteResult,
  { readonly ok: true }
>['lockStrategy']

/**
 * Collector テレメトリに付与される拡張プロパティ。
 * Bridge 側で state 遷移の `phaseBefore`/`phaseAfter` と Guard/Lock メタデータを注入する。
 */
export interface AutoSaveTelemetryEventProperties {
  readonly phaseBefore?: AutoSavePhase
  readonly phaseAfter?: AutoSavePhase
  readonly flagSource?: AutoSavePhaseGuardSnapshot['featureFlag']['source']
  readonly lockStrategy?: AutoSaveTelemetryLockStrategy | 'none'
  readonly performance?: { readonly flush_latency_ms: number }
  readonly detail?: {
    readonly retry_count?: number
    readonly phase?: AutoSavePhase
    readonly [key: string]: unknown
  }
  readonly [key: string]: unknown
}

const ZERO_FLUSH_LATENCY: AutoSaveTelemetryEventProperties['performance'] = {
  flush_latency_ms: 0
} as const

const createFlushLatencyPerformance = (
  latencyMs: number
): AutoSaveTelemetryEventProperties['performance'] =>
  latencyMs === 0 ? ZERO_FLUSH_LATENCY : { flush_latency_ms: latencyMs }

export interface AutoSaveTelemetryEvent {
  readonly name: string
  readonly properties?: AutoSaveTelemetryEventProperties
}

type AutoSaveTelemetryEventInput = Omit<AutoSaveTelemetryEvent, 'properties'> & {
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
  correlationCounter: number
  history: HistoryEntry[]
  retainedBytes: number
  forceDisabled: boolean
  flushStartedAtMs?: number
}

interface AutoSaveTelemetryContext {
  readonly before: AutoSaveStatusState
  readonly after: AutoSaveStatusState
  readonly guard: AutoSavePhaseGuardSnapshot
  readonly lockStrategy?: AutoSaveTelemetryLockStrategy
}

const sumBytes = (entries: readonly HistoryEntry[]): number => entries.reduce((acc, entry) => acc + entry.bytes, 0)

export const statusPhaseForState = (state: AutoSaveStatusState): AutoSavePhase => {
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
      return 'backoff'
  }
}

const API_VERSION = 1
const PHASE_BOOTSTRAP: AutoSaveEnvelopePhase = 'A-0'
const PHASE_STATUS: AutoSaveEnvelopePhase = 'A-1'
const PHASE_SNAPSHOT: AutoSaveEnvelopePhase = 'A-2'

const createBootstrapMessage = (
  reqId: string,
  correlationId: string,
  ts: string,
  policy: AutoSavePolicy,
  guard: AutoSavePhaseGuardSnapshot,
  flags: FlagSnapshot
): AutoSaveBridgeBootstrapMessage => ({
  type: 'bridge.bootstrap',
  apiVersion: API_VERSION,
  phase: PHASE_BOOTSTRAP,
  bridgePhase: 'bootstrap',
  reqId,
  correlationId,
  ts,
  payload: {
    version: 1,
    policy,
    guard,
    flags
  }
})

const createStatusMessage = (
  reqId: string,
  correlationId: string,
  ts: string,
  envelopePhase: AutoSaveEnvelopePhase,
  state: AutoSaveStatusState,
  guard: AutoSavePhaseGuardSnapshot,
  retryCount: number,
  lastSuccessAt: string | undefined,
  pendingBytes?: number
): AutoSaveStatusMessage => ({
  type: 'status.autosave',
  apiVersion: API_VERSION,
  phase: envelopePhase,
  bridgePhase: 'status.autosave',
  reqId,
  correlationId,
  ts,
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
  ts: string,
  payload: AutoSaveSnapshotResultPayload
): AutoSaveSnapshotResultMessage => ({
  type: 'snapshot.result',
  apiVersion: API_VERSION,
  phase: request.phase ?? PHASE_SNAPSHOT,
  bridgePhase: 'snapshot.result',
  reqId: request.reqId,
  correlationId: request.correlationId,
  ts,
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

const emitTelemetry = (
  options: AutoSaveHostBridgeOptions,
  event: AutoSaveTelemetryEventInput,
  context: AutoSaveTelemetryContext
): void => {
  const phaseBefore = statusPhaseForState(context.before)
  const phaseAfter = statusPhaseForState(context.after)
  const rawProperties = event.properties ?? {}
  const providedRetryCount =
    typeof (rawProperties as { retryCount?: unknown }).retryCount === 'number'
      ? (rawProperties as { retryCount: number }).retryCount
      : undefined
  const providedDetail = rawProperties.detail
  const detailFromProperties =
    typeof providedDetail === 'object' && providedDetail !== null
      ? { ...(providedDetail as Record<string, unknown>) }
      : undefined
  const detailRetry =
    detailFromProperties && typeof (detailFromProperties as { retry_count?: unknown }).retry_count === 'number'
      ? (detailFromProperties as { retry_count: number }).retry_count
      : undefined
  const normalizedDetail: AutoSaveTelemetryEventProperties['detail'] | undefined = (() => {
    const candidate =
      typeof detailRetry === 'number'
        ? detailRetry
        : typeof providedRetryCount === 'number'
          ? providedRetryCount
          : undefined
    if (!detailFromProperties && (typeof candidate !== 'number' || Number.isNaN(candidate))) {
      return undefined
    }
    const detailPayload: Record<string, unknown> = detailFromProperties ? { ...detailFromProperties } : {}
    if (typeof candidate === 'number' && !Number.isNaN(candidate)) {
      detailPayload.retry_count = Math.max(0, Math.trunc(candidate))
    }
    return Object.keys(detailPayload).length > 0
      ? (detailPayload as AutoSaveTelemetryEventProperties['detail'])
      : undefined
  })()
  const properties: AutoSaveTelemetryEventProperties = {
    ...rawProperties,
    ...(normalizedDetail ? { detail: normalizedDetail } : {}),
    phaseBefore,
    phaseAfter,
    flagSource: context.guard.featureFlag.source,
    lockStrategy: context.lockStrategy ?? 'none'
  }
  options.telemetry?.({ ...event, properties })
}

const emitWarn = (options: AutoSaveHostBridgeOptions, event: AutoSaveWarnEvent): void => {
  options.warn?.(event)
}

const computeFlushLatencyMs = (state: InternalState, nowMs: number): number => {
  const startedAt = state.flushStartedAtMs
  if (typeof startedAt !== 'number') {
    return 0
  }
  return Math.max(0, nowMs - startedAt)
}

const nextReqId = (state: InternalState): string => `autosave-${++state.reqCounter}`
const nextCorrelationId = (state: InternalState): string => `autosave-corr-${++state.correlationCounter}`

const clampMilliseconds = (value: number): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0
  }
  return Math.max(0, Math.round(value))
}

const clampCount = (value: number): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0
  }
  return Math.max(0, Math.trunc(value))
}

const normalizeErrorCode = (code: string): string => {
  const trimmed = typeof code === 'string' ? code.trim() : ''
  return trimmed ? trimmed : 'unknown'
}

const normalizeErrorMessage = (message: string | undefined, fallback: string): string => {
  if (typeof message !== 'string') {
    return fallback
  }
  const trimmed = message.trim()
  return trimmed ? trimmed : fallback
}

const computeLagSeconds = (
  lastSuccessAt: string | undefined,
  timestamp: string
): number | undefined => {
  if (!lastSuccessAt) {
    return undefined
  }
  const last = Date.parse(lastSuccessAt)
  const current = Date.parse(timestamp)
  if (!Number.isFinite(last) || Number.isNaN(last) || !Number.isFinite(current) || Number.isNaN(current)) {
    return undefined
  }
  const diffMs = current - last
  if (!Number.isFinite(diffMs) || Number.isNaN(diffMs) || diffMs < 0) {
    return undefined
  }
  return Math.max(0, Math.floor(diffMs / 1000))
}

export const resolveCollectorPhase = (guard: AutoSavePhaseGuardSnapshot): RolloutPhase => {
  if (!guard.featureFlag.value || guard.optionsDisabled) {
    return 'A-0'
  }
  switch (guard.featureFlag.source) {
    case 'env':
      return 'A-1'
    case 'workspace':
      return 'A-2'
    default:
      return 'A-0'
  }
}

type SnapshotResultDetailPhase = AutoSaveStatusSnapshot['phase']

type SnapshotResultSuccessDetailWithPhase = SnapshotResultSuccessDetail & {
  readonly phase: SnapshotResultDetailPhase
}

type SnapshotResultFailureDetailWithPhase = SnapshotResultFailureDetail & {
  readonly phase: SnapshotResultDetailPhase
}

const createSnapshotSuccessDetail = (
  durationMs: number,
  retryCount: number,
  lagSeconds: number | undefined,
  phase: SnapshotResultDetailPhase
): SnapshotResultSuccessDetailWithPhase => {
  const baseDetail = {
    duration_ms: clampMilliseconds(durationMs),
    retry_count: clampCount(retryCount),
    retryable: false as const,
    error_code: null,
    phase
  }
  if (lagSeconds === undefined) {
    return baseDetail
  }
  return { ...baseDetail, lag_seconds: clampCount(lagSeconds) }
}

const createSnapshotFailureDetail = (
  durationMs: number,
  retryCount: number,
  retryable: boolean,
  errorCode: string,
  errorMessage: string,
  lagSeconds: number | undefined,
  phase: SnapshotResultDetailPhase
): SnapshotResultFailureDetailWithPhase => {
  const code = normalizeErrorCode(errorCode)
  const baseDetail = {
    duration_ms: clampMilliseconds(durationMs),
    retry_count: clampCount(retryCount),
    retryable,
    error_code: code,
    error_message: normalizeErrorMessage(errorMessage, code),
    phase
  }
  if (lagSeconds === undefined) {
    return baseDetail
  }
  return { ...baseDetail, lag_seconds: clampCount(lagSeconds) }
}

const createSnapshotPayload = (
  bytes: number,
  retainedBytes: number,
  generation: number,
  lastSuccessAt: string | undefined,
  fallbackTs: string
): SnapshotResultSnapshot => ({
  bytes: clampCount(bytes),
  retained_bytes: clampCount(retainedBytes),
  generation: clampCount(generation),
  last_success_at:
    typeof lastSuccessAt === 'string' && lastSuccessAt.trim()
      ? lastSuccessAt
      : fallbackTs
})

type SnapshotResultCollectorPayload =
  | {
      readonly status: 'success'
      readonly detail: SnapshotResultSuccessDetail
      readonly snapshot: SnapshotResultSnapshot
    }
  | {
      readonly status: 'failure'
      readonly detail: SnapshotResultFailureDetail
      readonly snapshot?: SnapshotResultSnapshot
    }

const publishCollectorSnapshotResult = (
  request: AutoSaveSnapshotRequestMessage,
  guard: AutoSavePhaseGuardSnapshot,
  timestamp: string,
  payload: SnapshotResultCollectorPayload
): void => {
  publishSnapshotResult({
    phase: resolveCollectorPhase(guard),
    status: payload.status,
    detail: payload.detail,
    snapshot: payload.snapshot,
    overrides: {
      reqId: request.reqId,
      correlationId: request.correlationId,
      ts: timestamp
    }
  })
}

const handleNonRetryableError = (
  options: AutoSaveHostBridgeOptions,
  state: InternalState,
  request: AutoSaveSnapshotRequestMessage,
  error: AutoSaveError,
  previousStatus: AutoSaveStatusState
): void => {
  const guardForTelemetry = state.guard
  const errorEnvelopePhase = request.phase ?? PHASE_SNAPSHOT
  const retryCountBeforeReset = state.retryCount
  state.status = 'error'
  const errorTimestamp = options.now()
  const ts = toIso(errorTimestamp)
  const flushLatencyMs = computeFlushLatencyMs(state, errorTimestamp.getTime())
  state.flushStartedAtMs = undefined
  options.sendMessage(
    createSnapshotResultMessage(request, ts, { ok: false, error })
  )
  const statusPhase = statusPhaseForState(state.status)
  publishCollectorSnapshotResult(request, guardForTelemetry, ts, {
    status: 'failure',
    detail: createSnapshotFailureDetail(
      flushLatencyMs,
      retryCountBeforeReset,
      error.retryable,
      error.code,
      error.message,
      computeLagSeconds(state.lastSuccessAt, ts),
      statusPhase
    )
  })
  emitTelemetry(
    options,
    {
      name: 'autosave.snapshot.result',
      properties: {
        ok: false,
        code: error.code,
        retryable: error.retryable,
        correlationId: request.correlationId,
        retryCount: retryCountBeforeReset,
        phase: errorEnvelopePhase,
        performance: createFlushLatencyPerformance(flushLatencyMs),
        detail: { phase: statusPhase }
      }
    },
    { before: previousStatus, after: state.status, guard: guardForTelemetry }
  )
  options.sendMessage(
    createStatusMessage(
      request.reqId,
      request.correlationId,
      ts,
      errorEnvelopePhase,
      'error',
      state.guard,
      retryCountBeforeReset,
      state.lastSuccessAt
    )
  )
  emitTelemetry(
    options,
    {
      name: 'autosave.status',
      properties: {
        state: 'error',
        correlationId: request.correlationId,
        retryCount: retryCountBeforeReset,
        phase: errorEnvelopePhase,
        performance: createFlushLatencyPerformance(flushLatencyMs)
      }
    },
    { before: previousStatus, after: state.status, guard: guardForTelemetry }
  )
  const statusBeforeDisable = state.status
  state.status = 'disabled'
  state.guard = {
    featureFlag: state.guard.featureFlag,
    optionsDisabled: true
  }
  options.sendMessage(
    createStatusMessage(
      request.reqId,
      request.correlationId,
      ts,
      PHASE_STATUS,
      'disabled',
      state.guard,
      retryCountBeforeReset,
      state.lastSuccessAt
    )
  )
  emitTelemetry(
    options,
    {
      name: 'autosave.status',
      properties: {
        state: 'disabled',
        correlationId: request.correlationId,
        retryCount: retryCountBeforeReset,
        phase: PHASE_STATUS,
        performance: createFlushLatencyPerformance(flushLatencyMs)
      }
    },
    { before: statusBeforeDisable, after: state.status, guard: state.guard }
  )
  state.retryCount = 0
  state.forceDisabled = true
}

export const createVscodeAutoSaveBridge = (options: AutoSaveHostBridgeOptions): AutoSaveHostBridge => {
  const state: InternalState = {
    guard: options.initialGuard,
    lastSuccessAt: undefined,
    retryCount: 0,
    status: 'disabled',
    reqCounter: 0,
    correlationCounter: 0,
    history: [],
    retainedBytes: 0,
    forceDisabled: false,
    flushStartedAtMs: undefined
  }

  const bootstrapFlags =
    options.flags ??
    resolveFlags({ workspace: options.workspace ?? null, clock: options.now })
  const bootstrapReqId = nextReqId(state)
  const bootstrapCorrelationId = nextCorrelationId(state)
  options.sendMessage(
    createBootstrapMessage(
      bootstrapReqId,
      bootstrapCorrelationId,
      toIso(options.now()),
      options.policy,
      options.initialGuard,
      bootstrapFlags
    )
  )

  const reportDirty = (pendingBytes: number, guard: AutoSavePhaseGuardSnapshot): void => {
    const previousStatus = state.status
    const shouldForceDisable = state.forceDisabled
    state.guard = mergeGuard(state.guard, guard, shouldForceDisable)
    const ts = toIso(options.now())
    const correlationId = nextCorrelationId(state)
    const envelopePhase = PHASE_STATUS
    const flushLatency = ZERO_FLUSH_LATENCY
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
      emitTelemetry(
        options,
        {
          name: 'autosave.status',
          properties: {
            state: 'disabled',
            source: 'phase-guard',
            correlationId,
            retryCount: state.retryCount,
            phase: envelopePhase,
            performance: flushLatency
          }
        },
        { before: previousStatus, after: state.status, guard: state.guard }
      )
      emitTelemetry(
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
      emitTelemetry(
        options,
        {
          name: 'autosave.status',
          properties: {
            state: 'dirty',
            pendingBytes,
            correlationId,
            retryCount: state.retryCount,
            phase: envelopePhase,
            performance: flushLatency
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
    state.guard = mergeGuard(state.guard, incomingGuard, shouldForceDisable)
    const ts = toIso(requestStartedAt)
    const requestEnvelopePhase = request.phase ?? PHASE_SNAPSHOT
    if (!isGuardEnabled(state.guard)) {
      state.status = 'disabled'
      state.retryCount = 0
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
      emitTelemetry(
        options,
        {
          name: 'autosave.snapshot.result',
          properties: {
            ok: false,
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
      emitTelemetry(
        options,
        {
          name: 'autosave.status',
          properties: {
            state: 'disabled',
            correlationId: request.correlationId,
            retryCount: state.retryCount,
            phase: PHASE_STATUS,
            performance: ZERO_FLUSH_LATENCY
          }
        },
        { before: statusBeforeRequest, after: state.status, guard: state.guard }
      )
      emitTelemetry(
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
    emitTelemetry(
      options,
      {
        name: 'autosave.status',
        properties: {
          state: 'saving',
          reqId: request.reqId,
          correlationId: request.correlationId,
          retryCount: state.retryCount,
          phase: requestEnvelopePhase,
          performance: ZERO_FLUSH_LATENCY
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
        const retryTs = toIso(retryTimestamp)
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
        emitTelemetry(
          options,
          {
            name: 'autosave.status',
            properties: {
              state: 'backoff',
              correlationId: request.correlationId,
              retryCount: state.retryCount,
              phase: requestEnvelopePhase,
              performance: createFlushLatencyPerformance(retryLatency)
            }
          },
          { before: statusBeforeBackoff, after: state.status, guard: state.guard }
        )
        emitTelemetry(
          options,
          {
            name: 'autosave.snapshot.result',
            properties: {
              ok: false,
              code: writeResult.error.code,
            retryable: true,
            correlationId: request.correlationId,
            retryCount: state.retryCount,
            phase: requestEnvelopePhase,
            performance: createFlushLatencyPerformance(retryLatency),
            detail: { phase: statusPhase }
          }
        },
        { before: statusBeforeBackoff, after: state.status, guard: state.guard }
      )
        return
      }
      handleNonRetryableError(options, state, request, writeResult.error, state.status)
      return
    }

    if (writeResult.lockStrategy === 'file-lock') {
      emitWarn(options, {
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
    const successTs = toIso(successTimestamp)
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
    emitTelemetry(
      options,
      {
        name: 'autosave.snapshot.result',
        properties: {
          ok: true,
          generation: writeResult.generation,
          retainedBytes: state.retainedBytes,
          correlationId: request.correlationId,
          retryCount: retryCountForSnapshot,
          phase: requestEnvelopePhase,
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
        state.lastSuccessAt
      )
    )
    emitTelemetry(
      options,
      {
        name: 'autosave.status',
        properties: {
          state: 'saved',
          reqId: request.reqId,
          correlationId: request.correlationId,
          retryCount: state.retryCount,
          phase: requestEnvelopePhase,
          performance: createFlushLatencyPerformance(successLatency)
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
