import type { AutoSavePhaseGuardSnapshot } from '../lib/autosave.js'
import {
  FEATURE_FLAG_DEFINITIONS,
  type FeatureFlagName,
  type FlagSnapshot,
  type FlagSource,
  type FlagValidationError
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

type CollectorRolloutPhase = 'A-0' | 'A-1' | 'A-2' | 'B-0' | 'B-1'

type FlagSnapshotEntry = {
  readonly flag: FeatureFlagName
  readonly variant: string
  readonly source: FlagSource
  readonly phase: CollectorRolloutPhase
}

type FlagResolutionPayload = {
  readonly flag: FeatureFlagName
  readonly variant: string
  readonly source: FlagSource
  readonly phase: CollectorRolloutPhase
  readonly evaluation_ms: number
}

export type Day8CollectorFlagResolutionEvent = {
  readonly type: 'telemetry.config.flags'
  readonly apiVersion: 1
  readonly reqId: string
  readonly ts: string
  readonly correlationId: string
  readonly phase: CollectorRolloutPhase
  readonly schema: 'vscode.telemetry.v1'
  readonly event: 'flag_resolution'
  readonly attempt: 1
  readonly maxAttempts: 3
  readonly backoffMs: readonly [100, 300, 900]
  readonly payload: FlagResolutionPayload
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

const TELEMETRY_ATTEMPT: 1 = 1
const TELEMETRY_MAX_ATTEMPTS: 3 = 3
const TELEMETRY_BACKOFF_MS = [100, 300, 900] as const

const ROLLOUT_PHASE_MAP = {
  'phase-a0': 'A-0',
  'phase-a1': 'A-1',
  'phase-a2': 'A-2',
  'phase-b0': 'B-0',
  'phase-b1': 'B-1'
} as const satisfies Record<string, CollectorRolloutPhase>

const toCollectorPhase = (flag: FeatureFlagName): CollectorRolloutPhase => {
  const definition = FEATURE_FLAG_DEFINITIONS[flag]
  const mapped = ROLLOUT_PHASE_MAP[definition.phase]
  return mapped ?? 'A-0'
}

const toFlagSnapshotEntries = (snapshot: FlagSnapshot): ReadonlyArray<FlagSnapshotEntry> => [
  {
    flag: 'autosave.enabled',
    variant: String(snapshot.autosave.value),
    source: snapshot.autosave.source,
    phase: toCollectorPhase('autosave.enabled')
  },
  {
    flag: 'plugins.enable',
    variant: String(snapshot.plugins.value),
    source: snapshot.plugins.source,
    phase: toCollectorPhase('plugins.enable')
  },
  {
    flag: 'merge.precision',
    variant: String(snapshot.merge.value),
    source: snapshot.merge.source,
    phase: toCollectorPhase('merge.precision')
  }
]

const createUniqueId = (): string => {
  const scope = globalThis as { crypto?: { randomUUID?: () => string } }
  const randomUUID = scope.crypto?.randomUUID
  if (typeof randomUUID === 'function') {
    try {
      const value = randomUUID.call(scope.crypto)
      if (typeof value === 'string' && value.length > 0) {
        return value
      }
    } catch {
      // ignore and fall back to Math.random
    }
  }
  const random = Math.random().toString(36).slice(2)
  return `${Date.now().toString(36)}-${random}`
}

export const publishFlagResolution = (
  source: string,
  phase: string,
  snapshot: FlagSnapshot,
  _errors: readonly FlagValidationError[],
  evaluationMs: number
): void => {
  const collector = getDay8Collector()
  if (!collector) {
    return
  }

  const evaluation = Number.isFinite(evaluationMs) && evaluationMs >= 0 ? evaluationMs : 0
  const correlationId = `${source}:${phase}:${createUniqueId()}`

  for (const entry of toFlagSnapshotEntries(snapshot)) {
    const event: Day8CollectorFlagResolutionEvent = {
      type: 'telemetry.config.flags',
      apiVersion: 1,
      reqId: `${entry.flag}:${createUniqueId()}`,
      ts: new Date().toISOString(),
      correlationId,
      phase: entry.phase,
      schema: 'vscode.telemetry.v1',
      event: 'flag_resolution',
      attempt: TELEMETRY_ATTEMPT,
      maxAttempts: TELEMETRY_MAX_ATTEMPTS,
      backoffMs: TELEMETRY_BACKOFF_MS,
      payload: {
        flag: entry.flag,
        variant: entry.variant,
        source: entry.source,
        phase: entry.phase,
        evaluation_ms: evaluation
      }
    }
    collector.publish(event)
  }
}
