import type { AutoSavePhase } from '../../lib/autosave.js'
import type { FlagRolloutPhase, MergePrecision } from '../../config/flags.js'
import { type RolloutPhase, type SnapshotResultDetailBase, type SnapshotResultFailureDetail, type SnapshotResultSnapshot, type SnapshotResultSuccessDetail } from '../../../scripts/monitor/collect-metrics.js'

type FlagPhaseToContractPhase = { readonly [Phase in FlagRolloutPhase]: RolloutPhase }

export const FLAG_PHASE_TO_CONTRACT_PHASE = {
  'phase-a0': 'A-0', 'phase-a1': 'A-1', 'phase-a2': 'A-2', 'phase-b0': 'B-0', 'phase-b1': 'B-1', 'phase-c0': 'C-0'
} as const satisfies FlagPhaseToContractPhase

export const MERGE_PRECISION_TO_CONTRACT_PHASE: Record<MergePrecision, RolloutPhase> = {
  legacy: 'A-2', beta: 'B-0', stable: 'B-1'
}

export const clampDuration = (value: number): number =>
  typeof value !== 'number' || Number.isNaN(value) ? 0 : Math.max(0, Math.round(value))

export const clampRetryCount = (value: number): number =>
  typeof value !== 'number' || Number.isNaN(value) ? 0 : Math.max(0, Math.trunc(value))

const normalizeLagSeconds = (value: number | undefined): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }
  const normalized = Math.floor(value)
  return Number.isFinite(normalized) && !Number.isNaN(normalized)
    ? Math.max(0, normalized)
    : undefined
}

type SnapshotResultDetailPhaseCarrier = { readonly phase?: AutoSavePhase }

const readDetailPhase = (detail: SnapshotResultDetailBase): AutoSavePhase | undefined => {
  const candidate = (detail as SnapshotResultDetailPhaseCarrier).phase
  return typeof candidate === 'string' ? candidate : undefined
}

const withOptionalPhase = <T extends SnapshotResultDetailBase>(
  base: T,
  phase: AutoSavePhase | undefined
): T & SnapshotResultDetailPhaseCarrier => (phase === undefined ? base : { ...base, phase })

export const normalizeSuccessDetail = (
  detail: SnapshotResultSuccessDetail
): SnapshotResultSuccessDetail & SnapshotResultDetailPhaseCarrier => {
  const lagSeconds = normalizeLagSeconds(detail.lag_seconds)
  const normalizedBase = {
    duration_ms: clampDuration(detail.duration_ms),
    retry_count: clampRetryCount(detail.retry_count),
    retryable: false as const,
    error_code: null
  }
  const withPhase = withOptionalPhase(normalizedBase, readDetailPhase(detail))
  return lagSeconds === undefined ? withPhase : { ...withPhase, lag_seconds: lagSeconds }
}

export const normalizeFailureDetail = (
  detail: SnapshotResultFailureDetail
): SnapshotResultFailureDetail & SnapshotResultDetailPhaseCarrier => {
  const codeCandidate = typeof detail.error_code === 'string' ? detail.error_code.trim() : ''
  const error_code = codeCandidate ? codeCandidate : 'unknown'
  const messageCandidate = typeof detail.error_message === 'string' ? detail.error_message.trim() : ''
  const lagSeconds = normalizeLagSeconds(detail.lag_seconds)
  const normalizedBase = {
    duration_ms: clampDuration(detail.duration_ms),
    retry_count: clampRetryCount(detail.retry_count),
    retryable: Boolean(detail.retryable),
    error_code,
    error_message: messageCandidate ? messageCandidate : error_code
  }
  const withPhase = withOptionalPhase(normalizedBase, readDetailPhase(detail))
  return lagSeconds === undefined ? withPhase : { ...withPhase, lag_seconds: lagSeconds }
}

export const normalizeSnapshot = (snapshot: SnapshotResultSnapshot, fallbackTs: string): SnapshotResultSnapshot => {
  const lastSuccess = typeof snapshot.last_success_at === 'string' ? snapshot.last_success_at.trim() : ''
  const base = {
    bytes: clampRetryCount(snapshot.bytes),
    retained_bytes: clampRetryCount(snapshot.retained_bytes),
    generation: clampRetryCount(snapshot.generation),
    last_success_at: fallbackTs
  }
  return lastSuccess ? { ...base, last_success_at: lastSuccess } : base
}

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const isUuid = (candidate: unknown): candidate is string =>
  typeof candidate === 'string' && UUID_REGEX.test(candidate)

export const createTelemetryId = (): string => {
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
