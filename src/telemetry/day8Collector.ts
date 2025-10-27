import type { AutoSavePhaseGuardSnapshot } from '../lib/autosave.js'
import type {
  FeatureFlagName,
  FlagRolloutPhase,
  FlagSource,
  FlagValidationError
} from '../config/flags.js'

type RolloutPhaseContract = 'A-0' | 'A-1' | 'A-2' | 'B-0' | 'B-1'

const FLAG_PHASE_TO_CONTRACT_PHASE: Record<FlagRolloutPhase, RolloutPhaseContract> = {
  'phase-a0': 'A-0',
  'phase-a1': 'A-1',
  'phase-b0': 'B-0'
} as const

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
  readonly detail: { readonly retryable: boolean }
}

export type FlagResolutionContractPayload = {
  readonly flag: FeatureFlagName
  readonly variant: string
  readonly source: FlagSource
  readonly phase: RolloutPhaseContract
  readonly evaluation_ms: number
  readonly errors: readonly FlagValidationError[]
  readonly threshold: number | null
  readonly status: 'success' | 'failure'
  readonly detail: { readonly retryable: boolean }
}

export type Day8CollectorFlagResolutionEvent = {
  readonly schema: 'vscode.telemetry.v1'
  readonly feature: 'config.flags'
  readonly event: 'flag_resolution'
  readonly source: string
  readonly phase: string
  readonly evaluation_ms: number
  readonly payload: FlagResolutionContractPayload
  readonly ts: string
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

export const publishFlagResolution = (
  source: string,
  phase: string,
  payloads: readonly FlagResolutionEventPayload[],
  evaluationMs: number
): void => {
  const collector = getDay8Collector()
  if (!collector) {
    return
  }
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
      schema: 'vscode.telemetry.v1',
      feature: 'config.flags',
      event: 'flag_resolution',
      source,
      phase,
      evaluation_ms: evaluationMs,
      payload: contractPayload,
      ts: new Date().toISOString()
    })
  }
}
