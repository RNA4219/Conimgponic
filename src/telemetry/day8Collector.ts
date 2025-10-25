import type { AutoSavePhaseGuardSnapshot } from '../lib/autosave.js'
import type { FlagSnapshot, FlagValidationError } from '../config/flags.js'

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

export type Day8CollectorFlagResolutionEvent = {
  readonly feature: 'config.flags'
  readonly event: 'flag_resolution'
  readonly source: string
  readonly phase: string
  readonly snapshot: FlagSnapshot
  readonly errors: readonly FlagValidationError[]
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
  snapshot: FlagSnapshot,
  errors: readonly FlagValidationError[]
): void => {
  const collector = getDay8Collector()
  if (!collector) {
    return
  }
  collector.publish({
    feature: 'config.flags',
    event: 'flag_resolution',
    source,
    phase,
    snapshot,
    errors,
    ts: new Date().toISOString()
  })
}
