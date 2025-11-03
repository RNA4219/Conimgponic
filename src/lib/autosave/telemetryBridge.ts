import type { FlagSnapshot } from '../../config/flags.js'
import type { Storyboard } from '../../types'
import { resolveCollectorPhase } from './collector-phase.js'
import type {
  AutoSaveDisabledReason,
  AutoSaveError,
  AutoSavePhase,
  AutoSavePhaseGuardSnapshot,
  AutoSaveStatusState
} from '../autosave.js'
import type { AutoSavePolicy } from './policy.js'

interface Day8CollectorLike {
  publish(event: Record<string, unknown>): void
}

const resolveDay8Collector = (): Day8CollectorLike | undefined => {
  const scope = globalThis as { Day8Collector?: unknown }
  const candidate = scope.Day8Collector as { publish?: unknown } | undefined
  return candidate && typeof candidate.publish === 'function'
    ? (candidate as Day8CollectorLike)
    : undefined
}

const readImportMetaEnv = (): Record<string, unknown> | undefined => {
  try {
    const meta = import.meta as { env?: unknown }
    const env = meta?.env
    return typeof env === 'object' && env !== null ? (env as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

type BuildMetadataScope = {
  __APP_BUILD_SHA__?: unknown
  __APP_BUILD__?: { sha?: unknown }
  process?: { env?: Record<string, unknown> }
}

export const resolveBuildSha = (): string | undefined => {
  const scope = globalThis as BuildMetadataScope
  const importMetaEnv = readImportMetaEnv()
  const candidates: readonly unknown[] = [
    scope.__APP_BUILD_SHA__,
    scope.__APP_BUILD__?.sha,
    importMetaEnv?.VITE_BUILD_SHA,
    scope.process?.env?.BUILD_SHA,
    scope.process?.env?.GIT_COMMIT_SHA,
    scope.process?.env?.VITE_BUILD_SHA
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate
    }
  }
  return undefined
}

export const publishGuardCollectorEvent = (
  guard: AutoSavePhaseGuardSnapshot,
  reason: AutoSaveDisabledReason
): void => {
  const collector = resolveDay8Collector()
  if (!collector) return
  collector.publish({
    feature: 'autosave-diff-merge',
    event: 'autosave.guard',
    blocked: true,
    level: 'debug',
    phase: 'disabled',
    reason,
    guard,
    ts: new Date().toISOString()
  })
}

interface AutoSaveWriteCompletedEvent {
  readonly guard: AutoSavePhaseGuardSnapshot
  readonly durationMs: number
  readonly bytes: number
  readonly generation: number
  readonly retryCount: number
  readonly source: 'manual' | 'auto'
  readonly ts: string
  readonly leaseId?: string
  readonly historyBytes: number
  readonly gcEvicted: number
}

export const AUTOSAVE_SCHEDULE_REQUESTED_EVENT = 'autosave.schedule.requested' as const
export type AutoSaveScheduleRequestedEventName = typeof AUTOSAVE_SCHEDULE_REQUESTED_EVENT

interface AutoSaveScheduleRequestedEvent {
  readonly guard: AutoSavePhaseGuardSnapshot
  readonly ts: string
  readonly reason: 'change' | 'flushNow'
  readonly pendingBytes: number
  readonly backlog: number
  readonly retryCount: number
  readonly buildSha: string
}

export const publishWriteCompletedCollectorEvent = (event: AutoSaveWriteCompletedEvent): void => {
  const collector = resolveDay8Collector()
  if (!collector) return
  const duration = Math.max(0, Math.round(event.durationMs))
  const payload: Record<string, unknown> = {
    component: 'autosave',
    feature: 'autosave',
    event: 'autosave.write.completed',
    phase: resolveCollectorPhase(event.guard),
    ts: event.ts,
    duration_ms: duration,
    bytes: event.bytes,
    history_size: event.historyBytes,
    gc_evicted: event.gcEvicted,
    generation: event.generation,
    retry_count: event.retryCount,
    source: event.source
  }
  if (event.leaseId) {
    payload.lease_id = event.leaseId
  }
  collector.publish(payload)
}

export const publishScheduleRequestedCollectorEvent = (
  event: AutoSaveScheduleRequestedEvent
): void => {
  const collector = resolveDay8Collector()
  if (!collector) return
  collector.publish({
    component: 'autosave',
    feature: 'autosave',
    event: AUTOSAVE_SCHEDULE_REQUESTED_EVENT,
    phase: resolveCollectorPhase(event.guard),
    ts: event.ts,
    build_sha: event.buildSha,
    reason: event.reason,
    pending_bytes: event.pendingBytes,
    backlog: event.backlog,
    flag_source: event.guard.featureFlag.source,
    retry_count: event.retryCount
  })
}

export type AutoSaveBridgePhase = 'bootstrap' | 'ready' | 'snapshot.request' | 'snapshot.result' | 'status.autosave'

export type AutoSaveEnvelopePhase = 'A-0' | 'A-1' | 'A-2' | 'B-0' | 'B-1'

export interface AutoSaveBridgeEnvelope<TType extends string, TPayload> {
  readonly type: TType
  readonly apiVersion: 1
  readonly phase: AutoSaveEnvelopePhase
  readonly bridgePhase: AutoSaveBridgePhase
  readonly reqId: string
  readonly correlationId: string
  readonly ts: string
  readonly payload: TPayload
}

export interface AutoSaveSnapshotRequestPayload {
  readonly reason: 'change' | 'flushNow'
  readonly storyboard: Storyboard
  readonly pendingBytes: number
  readonly queuedGeneration: number
  readonly debounceMs: AutoSavePolicy['debounceMs']
  readonly idleMs: AutoSavePolicy['idleMs']
  readonly historyLimit: AutoSavePolicy['maxGenerations']
  readonly sizeLimit: AutoSavePolicy['maxBytes']
  readonly guard: AutoSavePhaseGuardSnapshot
}

export type AutoSaveSnapshotRequestMessage = AutoSaveBridgeEnvelope<
  'snapshot.request',
  AutoSaveSnapshotRequestPayload
>

export type AutoSaveSnapshotResultPayload =
  | {
      readonly ok: true
      readonly bytes: number
      readonly lastSuccessAt: string
      readonly generation: number
      readonly retainedBytes: number
    }
  | {
      readonly ok: false
      readonly error: AutoSaveError
    }

export type AutoSaveSnapshotResultMessage = AutoSaveBridgeEnvelope<
  'snapshot.result',
  AutoSaveSnapshotResultPayload
>

export interface AutoSaveStatusPayload {
  readonly state: AutoSaveStatusState
  readonly phase: AutoSavePhase
  readonly retryCount: number
  readonly lastSuccessAt?: string
  readonly pendingBytes?: number
  readonly guard: AutoSavePhaseGuardSnapshot
  readonly attempt: number
}

export type AutoSaveStatusMessage = AutoSaveBridgeEnvelope<
  'status.autosave',
  AutoSaveStatusPayload
>

export type AutoSaveBridgeBootstrapMessage = AutoSaveBridgeEnvelope<
  'bridge.bootstrap',
  {
    readonly version: 1
    readonly policy: AutoSavePolicy
    readonly guard: AutoSavePhaseGuardSnapshot
    readonly flags: FlagSnapshot
  }
>

export type AutoSaveBridgeReadyMessage = AutoSaveBridgeEnvelope<
  'bridge.ready',
  {
    readonly accepted: boolean
    readonly reason?: string
  }
>

export type AutoSaveBridgeMessage =
  | AutoSaveBridgeBootstrapMessage
  | AutoSaveBridgeReadyMessage
  | AutoSaveSnapshotRequestMessage
  | AutoSaveSnapshotResultMessage
  | AutoSaveStatusMessage
