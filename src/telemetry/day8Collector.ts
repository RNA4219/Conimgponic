import type { AutoSavePhase, AutoSavePhaseGuardSnapshot } from '../lib/autosave.js'
import type {
  FeatureFlagName,
  FlagRolloutPhase,
  FlagSource,
  FlagValidationError,
  MergePrecision
} from '../config/flags.js'
import {
  COLLECT_METRICS_CONTRACT,
  type MessageEnvelope,
  type TelemetryComponent,
  type TelemetryFeature,
  type TelemetryKind,
  type TelemetryPayloads,
  type TelemetrySource,
  type RolloutPhase,
  type SnapshotResultDetailBase,
  type SnapshotResultFailureDetail,
  type SnapshotResultPayload,
  type SnapshotResultSnapshot,
  type SnapshotResultSuccessDetail
} from '../../scripts/monitor/collect-metrics'

import {
  FLAG_PHASE_TO_CONTRACT_PHASE,
  MERGE_PRECISION_TO_CONTRACT_PHASE,
  clampDuration,
  clampRetryCount,
  createTelemetryId,
  isUuid,
  normalizeFailureDetail,
  normalizeSnapshot,
  normalizeSuccessDetail
} from './day8Collector/normalizers.js'

type SnapshotResultComponent = Extract<TelemetryComponent, 'autosave'>
type SnapshotResultKind = Extract<TelemetryKind, 'save'>
type SnapshotResultSource = Extract<TelemetrySource, 'app.autosave'>

type MergeResultComponent = Extract<TelemetryComponent, 'merge'>
type MergeResultKind = Extract<TelemetryKind, 'merge'>
type MergeResultSource = Extract<TelemetrySource, 'app.merge'>
type MergeResultContractPayload = TelemetryPayloads['merge.result']
type MergeResultStatus = MergeResultContractPayload['status']

export type Day8CollectorAutoSaveGuardReason =
  | 'phase-a0-failsafe'
  | 'feature-flag-disabled'
  | 'options-disabled'

export type Day8CollectorAutoSaveGuardEvent = {
  readonly feature: 'autosave-diff-merge'
  readonly event: 'autosave.guard'
  readonly blocked: boolean
  readonly reason: Day8CollectorAutoSaveGuardReason
  readonly guard: AutoSavePhaseGuardSnapshot
  readonly ts: string
}

export interface FlagResolutionEventPayload {
  readonly flag: FeatureFlagName
  readonly variant: string
  readonly source: FlagSource
  readonly phase: FlagRolloutPhase
  readonly evaluation_ms: number
  readonly errors: readonly FlagValidationError[]
  /** merge.precision の判定結果では MergePrecision、その他は null を送信する。 */
  readonly precision: MergePrecision | null
  readonly threshold: number | null
  readonly status: 'success' | 'failure'
  readonly detail: { readonly retryable: boolean; readonly default_used: boolean }
}

export type FlagResolutionContractPayload = {
  readonly flag: FeatureFlagName
  readonly variant: string
  readonly source: FlagSource
  readonly phase: RolloutPhase
  readonly evaluation_ms: number
  readonly errors: readonly FlagValidationError[]
  /** merge.precision の判定結果では MergePrecision、その他は null を送信する。 */
  readonly precision: MergePrecision | null
  readonly threshold: number | null
  readonly status: 'success' | 'failure'
  readonly detail: { readonly retryable: boolean; readonly default_used: boolean }
}

type CollectorTelemetryEnvelope = MessageEnvelope & {
  readonly attempt: number
  readonly maxAttempts: number
  readonly backoffMs: ReadonlyArray<number>
}

type CollectorTelemetryEnvelopeSeed = Omit<CollectorTelemetryEnvelope, 'phase'>

type FlagResolutionComponent = Extract<TelemetryComponent, 'flags'>
type FlagResolutionKind = Extract<TelemetryKind, 'flag_resolution'>

type TelemetryErrorKind = Extract<TelemetryKind, 'error'>
type TelemetryErrorPayload = TelemetryPayloads['error']
type TelemetryErrorDetail = TelemetryErrorPayload['detail']

export type Day8CollectorFlagResolutionEvent = CollectorTelemetryEnvelope & {
  readonly schema: 'vscode.telemetry.v1'
  readonly feature: 'config.flags'
  readonly event: 'flag_resolution'
  readonly component: FlagResolutionComponent
  readonly kind: FlagResolutionKind
  readonly source: TelemetrySource
  readonly evaluation_ms: number
  readonly payload: FlagResolutionContractPayload
}

export type Day8CollectorSnapshotResultEvent = CollectorTelemetryEnvelope & {
  readonly schema: 'vscode.telemetry.v1'
  readonly feature: 'autosave-diff-merge'
  readonly event: 'snapshot.result'
  readonly component: SnapshotResultComponent
  readonly kind: SnapshotResultKind
  readonly source: SnapshotResultSource
  readonly evaluation_ms: number
  readonly payload: SnapshotResultPayload
}

export type Day8CollectorMergeResultEvent = CollectorTelemetryEnvelope & {
  readonly schema: 'vscode.telemetry.v1'
  readonly feature: 'autosave-diff-merge'
  readonly event: 'merge.result'
  readonly component: MergeResultComponent
  readonly kind: MergeResultKind
  readonly source: MergeResultSource
  readonly evaluation_ms: number
  readonly payload: MergeResultContractPayload
}

export type Day8CollectorErrorEvent = CollectorTelemetryEnvelope & {
  readonly schema: 'vscode.telemetry.v1'
  readonly feature: TelemetryFeature
  readonly event: 'error'
  readonly component: TelemetryComponent
  readonly kind: TelemetryErrorKind
  readonly source: TelemetrySource
  readonly evaluation_ms: number
  readonly payload: TelemetryErrorPayload
}

interface Day8CollectorErrorEventInput {
  readonly feature: TelemetryFeature
  readonly component: TelemetryComponent
  readonly source: TelemetrySource
  readonly phase: RolloutPhase
  readonly evaluationMs: number
  readonly detail: TelemetryErrorDetail
  readonly tags: ReadonlyArray<string>
}

interface PublishCollectorErrorInput extends Day8CollectorErrorEventInput {
  readonly overrides?: TelemetryEnvelopeOverrides
}

export type Day8CollectorEvent =
  | Day8CollectorAutoSaveGuardEvent
  | Day8CollectorFlagResolutionEvent
  | Day8CollectorSnapshotResultEvent
  | Day8CollectorMergeResultEvent
  | Day8CollectorErrorEvent

export interface Day8Collector {
  publish(event: Day8CollectorEvent): void
}

export const getDay8Collector = (): Day8Collector | undefined => {
  const scope = globalThis as { Day8Collector?: Day8Collector }
  const candidate = scope.Day8Collector
  return candidate && typeof candidate.publish === 'function' ? candidate : undefined
}

type TelemetryEnvelopeOverrides = {
  readonly reqId?: string
  readonly correlationId?: string
  readonly attempt?: number
  readonly maxAttempts?: number
  readonly backoffMs?: ReadonlyArray<number>
  readonly ts?: string
  readonly workspace_id?: string
}


const createCollectorTelemetryEnvelopeSeed = (
  phase: string,
  overrides?: TelemetryEnvelopeOverrides
): CollectorTelemetryEnvelopeSeed => {
  const retryPolicy = COLLECT_METRICS_CONTRACT.telemetry.retryPolicy
  const reqId = isUuid(overrides?.reqId) ? overrides.reqId : createTelemetryId()
  const correlationId = isUuid(overrides?.correlationId) ? overrides.correlationId : reqId
  const maxAttempts = overrides?.maxAttempts ?? retryPolicy.maxAttempts
  const attempt = Math.min(Math.max(1, overrides?.attempt ?? 1), maxAttempts)
  const backoffMs = overrides?.backoffMs ?? retryPolicy.backoffMs
  const workspaceId = resolveWorkspaceId(overrides?.workspace_id)

  return {
    type: 'telemetry.event',
    apiVersion: 1,
    reqId,
    ts: overrides?.ts ?? new Date().toISOString(),
    correlationId,
    workspace_id: workspaceId,
    attempt,
    maxAttempts,
    backoffMs
  }
}

const applyPhaseToEnvelope = (
  seed: CollectorTelemetryEnvelopeSeed,
  phase: RolloutPhase
): CollectorTelemetryEnvelope => ({
  ...seed,
  phase
})


const readWorkspaceIdFromEnv = (): string | undefined => {
  const scope = globalThis as {
    process?: { env?: Record<string, unknown> }
  }
  const envCandidate = scope.process?.env?.CONIMG_WORKSPACE_ID
  if (typeof envCandidate !== 'string') {
    return undefined
  }
  const normalized = envCandidate.trim()
  return normalized ? normalized : undefined
}

let cachedWorkspaceId: string | undefined

const resolveWorkspaceId = (candidate?: string): string => {
  if (isUuid(candidate)) {
    return candidate
  }

  if (cachedWorkspaceId && isUuid(cachedWorkspaceId)) {
    return cachedWorkspaceId
  }

  const envId = readWorkspaceIdFromEnv()
  cachedWorkspaceId = isUuid(envId) ? envId : createTelemetryId()
  return cachedWorkspaceId
}

/**
 * @internal テスト専用: Day8 Collector 内部の workspace_id キャッシュを初期化する。
 */
export const resetWorkspaceIdCacheForTests = (): void => {
  cachedWorkspaceId = undefined
}

const emitCollectorError = (
  collector: Day8Collector,
  envelopeSeed: CollectorTelemetryEnvelopeSeed,
  input: Day8CollectorErrorEventInput
): void => {
  const normalizedErrorCode = input.detail.error_code.trim()
  const message =
    typeof input.detail.message === 'string' ? input.detail.message.trim() : undefined

  const detail: TelemetryErrorDetail = {
    error_code: normalizedErrorCode ? normalizedErrorCode : 'unknown',
    retryable: input.detail.retryable,
    ...(message ? { message } : {})
  }

  const tagSet = new Set<string>([
    `component:${input.component}`,
    `feature:${input.feature}`,
    `phase:${input.phase}`,
    `correlation:${envelopeSeed.correlationId}`
  ])

  for (const candidate of input.tags) {
    if (typeof candidate !== 'string') {
      continue
    }
    const normalized = candidate.trim()
    if (normalized) {
      tagSet.add(normalized)
    }
  }

  const tags = Array.from(tagSet)
  if (tags.length === 0) {
    tags.push(`component:${input.component}`)
  }

  collector.publish({
    ...applyPhaseToEnvelope(envelopeSeed, input.phase),
    schema: 'vscode.telemetry.v1',
    feature: input.feature,
    component: input.component,
    kind: 'error',
    event: 'error',
    source: input.source,
    evaluation_ms: Math.max(0, input.evaluationMs),
    payload: {
      detail,
      tags
    }
  })
}

export const publishCollectorError = (input: PublishCollectorErrorInput): void => {
  const collector = getDay8Collector()
  if (!collector) {
    return
  }
  const envelopeSeed = createCollectorTelemetryEnvelopeSeed(
    input.phase,
    input.overrides
  )
  emitCollectorError(collector, envelopeSeed, input)
}

interface PublishSnapshotResultInput {
  readonly phase: RolloutPhase
  readonly status: SnapshotResultPayload['status']
  readonly detail: SnapshotResultSuccessDetail | SnapshotResultFailureDetail
  readonly snapshot?: SnapshotResultSnapshot
  readonly overrides?: TelemetryEnvelopeOverrides
  readonly source?: SnapshotResultSource
}

interface PublishMergeResultErrorInput {
  readonly code?: string
  readonly message?: string
  readonly retryable?: boolean
}

interface PublishMergeResultInput {
  readonly precision: MergePrecision
  readonly processingMs: number
  readonly conflictSegments: number
  readonly status: MergeResultStatus
  readonly overrides?: TelemetryEnvelopeOverrides
  readonly source?: MergeResultSource
  readonly phase?: RolloutPhase
  readonly error?: PublishMergeResultErrorInput
}

export const publishSnapshotResult = (input: PublishSnapshotResultInput): void => {
  const collector = getDay8Collector()
  if (!collector) {
    return
  }

  const timestamp = input.overrides?.ts ?? new Date().toISOString()
  const envelopeOverrides: TelemetryEnvelopeOverrides = {
    ...input.overrides,
    ts: timestamp
  }
  const envelopeSeed = createCollectorTelemetryEnvelopeSeed(
    input.phase,
    envelopeOverrides
  )

  if (input.status === 'success') {
    if (!input.snapshot) {
      return
    }
    const detail = normalizeSuccessDetail(
      input.detail as SnapshotResultSuccessDetail
    )
    const snapshot = normalizeSnapshot(input.snapshot, timestamp)
    collector.publish({
      ...applyPhaseToEnvelope(envelopeSeed, input.phase),
      schema: 'vscode.telemetry.v1',
      feature: 'autosave-diff-merge',
      component: 'autosave',
      kind: 'save',
      event: 'snapshot.result',
      source: input.source ?? 'app.autosave',
      evaluation_ms: detail.duration_ms,
      payload: {
        status: 'success',
        detail,
        snapshot
      }
    })
    return
  }

  const detail = normalizeFailureDetail(input.detail as SnapshotResultFailureDetail)
  const snapshot = input.snapshot
    ? normalizeSnapshot(input.snapshot, timestamp)
    : undefined

  collector.publish({
    ...applyPhaseToEnvelope(envelopeSeed, input.phase),
    schema: 'vscode.telemetry.v1',
    feature: 'autosave-diff-merge',
    component: 'autosave',
    kind: 'save',
    event: 'snapshot.result',
    source: input.source ?? 'app.autosave',
    evaluation_ms: detail.duration_ms,
    payload: {
      status: 'failure',
      detail,
      ...(snapshot ? { snapshot } : {})
    }
  })
}

const resolveMergeResultPhase = (
  precision: MergePrecision,
  override?: RolloutPhase
): RolloutPhase => {
  if (override) {
    return override
  }
  return MERGE_PRECISION_TO_CONTRACT_PHASE[precision] ?? 'A-2'
}

const normalizeMergeResultError = (
  status: MergeResultStatus,
  error: PublishMergeResultErrorInput | undefined
): MergeResultContractPayload['error'] | undefined => {
  if (status !== 'error') {
    return undefined
  }
  const codeCandidate = typeof error?.code === 'string' ? error.code.trim() : ''
  const messageCandidate = typeof error?.message === 'string' ? error.message.trim() : ''
  const code = codeCandidate ? codeCandidate : 'unknown'
  const message = messageCandidate ? messageCandidate : code
  return {
    code,
    message,
    retryable: Boolean(error?.retryable)
  }
}

const normalizeMergeConflictSegments = (
  status: MergeResultStatus,
  value: number
): number => {
  const normalized = clampRetryCount(value)
  if (status === 'success') {
    return 0
  }
  if (status === 'conflict') {
    return Math.max(1, normalized)
  }
  return normalized
}

export const publishMergeResult = (input: PublishMergeResultInput): void => {
  const collector = getDay8Collector()
  if (!collector) {
    return
  }

  const phase = resolveMergeResultPhase(input.precision, input.phase)
  const envelopeSeed = createCollectorTelemetryEnvelopeSeed(phase, input.overrides)
  const evaluationMs = clampDuration(input.processingMs)
  const conflictSegments = normalizeMergeConflictSegments(input.status, input.conflictSegments)
  const error = normalizeMergeResultError(input.status, input.error)

  const payload: MergeResultContractPayload = {
    status: input.status,
    precision: input.precision,
    processing_ms: evaluationMs,
    conflict_segments: conflictSegments,
    ...(error ? { error } : {})
  }

  collector.publish({
    ...applyPhaseToEnvelope(envelopeSeed, phase),
    schema: 'vscode.telemetry.v1',
    feature: 'autosave-diff-merge',
    component: 'merge',
    kind: 'merge',
    event: 'merge.result',
    source: input.source ?? 'app.merge',
    evaluation_ms: evaluationMs,
    payload
  })
}

export const publishFlagResolution = (
  source: TelemetrySource,
  phase: string,
  payloads: readonly FlagResolutionEventPayload[],
  evaluationMs: number,
  overrides?: TelemetryEnvelopeOverrides
): void => {
  const collector = getDay8Collector()
  if (!collector) {
    return
  }
  const envelopeSeed = createCollectorTelemetryEnvelopeSeed(phase, overrides)
  for (const payload of payloads) {
    const contractPayload: FlagResolutionContractPayload = {
      flag: payload.flag,
      variant: payload.variant,
      source: payload.source,
      phase: FLAG_PHASE_TO_CONTRACT_PHASE[payload.phase],
      evaluation_ms: payload.evaluation_ms,
      errors: payload.errors,
      precision: payload.precision,
      threshold: payload.threshold,
      status: payload.status,
      detail: payload.detail
    }
    collector.publish({
      ...applyPhaseToEnvelope(envelopeSeed, contractPayload.phase),
      schema: 'vscode.telemetry.v1',
      feature: 'config.flags',
      component: 'flags',
      kind: 'flag_resolution',
      event: 'flag_resolution',
      source,
      evaluation_ms: evaluationMs,
      payload: contractPayload
    })

    if (payload.errors.length > 0) {
      const primaryError = payload.errors[0]
      const errorCode = primaryError
        ? `flag_resolution.${primaryError.code}`
        : 'flag_resolution.failure'
      emitCollectorError(collector, envelopeSeed, {
        feature: 'config.flags',
        component: 'flags',
        source,
        phase: contractPayload.phase,
        evaluationMs,
        detail: {
          error_code: errorCode,
          retryable: payload.detail.retryable,
          message: primaryError?.message
        },
        tags: [
          `flag:${payload.flag}`,
          `status:${payload.status}`,
          `source:${payload.source}`,
          `errors:${payload.errors.length}`
        ]
      })
    }
  }
}

export {
  FLAG_PHASE_TO_CONTRACT_PHASE,
  MERGE_PRECISION_TO_CONTRACT_PHASE,
  clampDuration,
  clampRetryCount,
  createTelemetryId,
  isUuid,
  normalizeFailureDetail,
  normalizeSnapshot,
  normalizeSuccessDetail
} from './day8Collector/normalizers.js'
