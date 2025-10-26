import type { AutoSavePhaseGuardSnapshot } from '../lib/autosave.js'
import type {
  FeatureFlagName,
  FlagRolloutPhase,
  FlagSource,
  FlagValidationError
} from '../config/flags.js'

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
}

export type FlagResolutionContractPayload = Pick<
  FlagResolutionEventPayload,
  'flag' | 'variant' | 'source' | 'phase' | 'evaluation_ms'
>

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
      phase: payload.phase,
      evaluation_ms: payload.evaluation_ms
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
