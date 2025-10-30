import type {
  AutoSavePhase,
  AutoSavePhaseGuardSnapshot,
  AutoSaveSnapshotRequestMessage
} from '../../../lib/autosave.js';
import { publishSnapshotResult as defaultPublishSnapshotResult } from '../../../telemetry/day8Collector.js';
import type {
  RolloutPhase,
  SnapshotResultFailureDetail,
  SnapshotResultSnapshot,
  SnapshotResultSuccessDetail
} from '../../../../scripts/monitor/collect-metrics';

export interface AutoSaveTelemetryGuardProperties {
  readonly current: RolloutPhase;
  readonly rollbackTo: RolloutPhase;
}

export interface AutoSaveTelemetryEventProperties {
  readonly phaseBefore?: AutoSavePhase;
  readonly phaseAfter?: AutoSavePhase;
  readonly phase_step?: AutoSavePhase;
  readonly attempt?: number;
  readonly flagSource?: AutoSavePhaseGuardSnapshot['featureFlag']['source'];
  readonly guard?: AutoSaveTelemetryGuardProperties;
  readonly lockStrategy?: AutoSaveTelemetryLockStrategy | 'none';
  readonly performance?: { readonly flush_latency_ms: number };
  readonly detail?: {
    readonly retry_count?: number;
    readonly phase?: AutoSavePhase;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

export interface AutoSaveTelemetryEvent {
  readonly name: string;
  readonly properties?: AutoSaveTelemetryEventProperties;
}

export type AutoSaveTelemetryEventInput = Omit<AutoSaveTelemetryEvent, 'properties'> & {
  readonly properties?: Record<string, unknown>;
};

export interface AutoSaveWarnEvent {
  readonly code: string;
  readonly details?: Record<string, unknown>;
}

export interface AutoSaveAtomicWriteInput {
  readonly request: AutoSaveSnapshotRequestMessage;
  readonly retainedBytes: number;
  readonly historyEntries: number;
}

export type AutoSaveTelemetryLockStrategy = Extract<
  AutoSaveAtomicWriteResult,
  { readonly ok: true }
>['lockStrategy'];

export type AutoSaveAtomicWriteResult =
  | {
      readonly ok: true;
      readonly bytes: number;
      readonly generation: number;
      readonly lastSuccessAt: string;
      readonly lockStrategy: 'web-lock' | 'file-lock';
    }
  | {
      readonly ok: false;
      readonly error: import('../../../lib/autosave.js').AutoSaveError;
    };

export interface PublishSnapshotResultDependencies {
  readonly publishSnapshotResult?: typeof defaultPublishSnapshotResult;
}

export type SnapshotResultDetailPhase = import('../../../lib/autosave.js').AutoSaveStatusSnapshot['phase'];

export type SnapshotResultSuccessDetailWithPhase = SnapshotResultSuccessDetail & {
  readonly phase: SnapshotResultDetailPhase;
};

export type SnapshotResultFailureDetailWithPhase = SnapshotResultFailureDetail & {
  readonly phase: SnapshotResultDetailPhase;
};

export const ZERO_FLUSH_LATENCY: AutoSaveTelemetryEventProperties['performance'] = {
  flush_latency_ms: 0
} as const;

export const resolveCollectorPhase = (
  guard: AutoSavePhaseGuardSnapshot
): RolloutPhase => {
  if (!guard.featureFlag.value || guard.optionsDisabled) {
    return 'A-0';
  }
  switch (guard.featureFlag.source) {
    case 'env':
      return 'A-1';
    case 'workspace':
      return 'A-2';
    default:
      return 'A-0';
  }
};

export const resolveGuardRollbackPhase = (phase: RolloutPhase): RolloutPhase => {
  switch (phase) {
    case 'B-1':
      return 'B-0';
    case 'B-0':
      return 'A-2';
    case 'A-2':
      return 'A-1';
    case 'A-1':
      return 'A-0';
    default:
      return phase;
  }
};

export const encodeGuardTelemetry = (
  guard: AutoSavePhaseGuardSnapshot
): AutoSaveTelemetryGuardProperties => {
  const current = resolveCollectorPhase(guard);
  return { current, rollbackTo: resolveGuardRollbackPhase(current) };
};

export const createFlushLatencyPerformance = (
  latencyMs: number
): AutoSaveTelemetryEventProperties['performance'] =>
  latencyMs === 0 ? ZERO_FLUSH_LATENCY : { flush_latency_ms: latencyMs };

const clampMilliseconds = (value: number): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
};

const clampCount = (value: number): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
};

const normalizeErrorCode = (code: string): string => {
  const trimmed = typeof code === 'string' ? code.trim() : '';
  return trimmed ? trimmed : 'unknown';
};

const normalizeErrorMessage = (message: string | undefined, fallback: string): string => {
  if (typeof message !== 'string') {
    return fallback;
  }
  const trimmed = message.trim();
  return trimmed ? trimmed : fallback;
};

export const createSnapshotSuccessDetail = (
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
  };
  if (lagSeconds === undefined) {
    return baseDetail;
  }
  return { ...baseDetail, lag_seconds: clampCount(lagSeconds) };
};

export const createSnapshotFailureDetail = (
  durationMs: number,
  retryCount: number,
  retryable: boolean,
  errorCode: string,
  errorMessage: string,
  lagSeconds: number | undefined,
  phase: SnapshotResultDetailPhase
): SnapshotResultFailureDetailWithPhase => {
  const code = normalizeErrorCode(errorCode);
  const baseDetail = {
    duration_ms: clampMilliseconds(durationMs),
    retry_count: clampCount(retryCount),
    retryable,
    error_code: code,
    error_message: normalizeErrorMessage(errorMessage, code),
    phase
  };
  if (lagSeconds === undefined) {
    return baseDetail;
  }
  return { ...baseDetail, lag_seconds: clampCount(lagSeconds) };
};

export const createSnapshotPayload = (
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
});

export type SnapshotResultCollectorPayload =
  | {
      readonly status: 'success';
      readonly detail: SnapshotResultSuccessDetail;
      readonly snapshot: SnapshotResultSnapshot;
    }
  | {
      readonly status: 'failure';
      readonly detail: SnapshotResultFailureDetail;
      readonly snapshot?: SnapshotResultSnapshot;
    };

export const publishCollectorSnapshotResult = (
  request: AutoSaveSnapshotRequestMessage,
  guard: AutoSavePhaseGuardSnapshot,
  timestamp: string,
  payload: SnapshotResultCollectorPayload,
  dependencies: PublishSnapshotResultDependencies = {}
): void => {
  const { publishSnapshotResult = defaultPublishSnapshotResult } = dependencies;
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
  });
};
