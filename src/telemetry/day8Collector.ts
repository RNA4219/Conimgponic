import type { AutoSavePhaseGuardSnapshot } from '../lib/autosave.js'
import type {
  FeatureFlagName,
  FlagRolloutPhase,
  FlagSource,
  FlagValidationError
} from '../config/flags.js'
import {
  COLLECT_METRICS_CONTRACT,
  type MessageEnvelope,
  type TelemetryComponent,
  type TelemetryKind,
  type TelemetrySource,
  type RolloutPhase
} from '../../scripts/monitor/collect-metrics.js'

type FlagPhaseToContractPhase = { readonly [Phase in FlagRolloutPhase]: RolloutPhase }

const FLAG_PHASE_TO_CONTRACT_PHASE = {
  'phase-a0': 'A-0',
  'phase-a1': 'A-1',
  'phase-a2': 'A-2',
  'phase-b0': 'B-0',
  'phase-b1': 'B-1'
} as const satisfies FlagPhaseToContractPhase

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

export type Day8CollectorEvent =
  | Day8CollectorAutoSaveGuardEvent
  | Day8CollectorFlagResolutionEvent

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
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const isUuid = (candidate: unknown): candidate is string =>
  typeof candidate === 'string' && UUID_REGEX.test(candidate)

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

  return {
    type: 'telemetry.event',
    apiVersion: 1,
    reqId,
    ts: overrides?.ts ?? new Date().toISOString(),
    correlationId,
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

const createTelemetryId = (): string => {
  const scope = globalThis as {
    crypto?: {
      randomUUID?: () => string
      getRandomValues?: <T extends ArrayBufferView>(array: T) => T
    }
  }
  const randomUuid = scope.crypto?.randomUUID?.()
  if (randomUuid && UUID_REGEX.test(randomUuid)) {
    return randomUuid
  }

  const bytes = new Uint8Array(16)
  if (scope.crypto?.getRandomValues) {
    scope.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const toHex = (value: number) => value.toString(16).padStart(2, '0')
  return (
    `${toHex(bytes[0])}${toHex(bytes[1])}${toHex(bytes[2])}${toHex(bytes[3])}-` +
    `${toHex(bytes[4])}${toHex(bytes[5])}-` +
    `${toHex(bytes[6])}${toHex(bytes[7])}-` +
    `${toHex(bytes[8])}${toHex(bytes[9])}-` +
    `${toHex(bytes[10])}${toHex(bytes[11])}${toHex(bytes[12])}${toHex(bytes[13])}${toHex(bytes[14])}${toHex(bytes[15])}`
  )
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
  }
}
