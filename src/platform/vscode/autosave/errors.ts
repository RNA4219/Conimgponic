import type {
  AutoSaveBridgeMessage,
  AutoSaveError,
  AutoSaveSnapshotRequestMessage,
  AutoSaveStatusState,
  AutoSavePolicy
} from '../../../lib/autosave.js';

import type { AutoSaveTelemetryEventInput, AutoSaveWarnEvent } from './collector.js';
import {
  createFlushLatencyPerformance,
  createSnapshotFailureDetail,
  publishCollectorSnapshotResult
} from './collector.js';
import {
  computeFlushLatencyMs,
  computeLagSeconds,
  statusPhaseForState,
  type InternalState
} from './state.js';
import {
  createSnapshotResultMessage,
  createStatusMessage,
  PHASE_STATUS,
  PHASE_SNAPSHOT
} from './bootstrap.js';
import type { AutoSaveTelemetryContext } from './telemetry.js';

export interface NonRetryableErrorEnvironment {
  readonly now: () => Date;
  readonly sendMessage: (message: AutoSaveBridgeMessage) => void;
  readonly dispatchTelemetry: (
    event: AutoSaveTelemetryEventInput,
    context: AutoSaveTelemetryContext
  ) => void;
  readonly policy: AutoSavePolicy;
}

export const emitWarn = (
  warn: ((event: AutoSaveWarnEvent) => void) | undefined,
  event: AutoSaveWarnEvent
): void => {
  warn?.(event);
};

export const handleNonRetryableError = (
  env: NonRetryableErrorEnvironment,
  state: InternalState,
  request: AutoSaveSnapshotRequestMessage,
  error: AutoSaveError,
  previousStatus: AutoSaveStatusState
): void => {
  const guardForTelemetry = state.guard;
  const errorEnvelopePhase = request.phase ?? PHASE_SNAPSHOT;
  const requestDebounceMs =
    typeof request.payload.debounceMs === 'number'
      ? request.payload.debounceMs
      : env.policy.debounceMs;
  const retryCountBeforeReset = state.retryCount;
  const attempt = retryCountBeforeReset + 1;
  state.status = 'error';
  const errorTimestamp = env.now();
  const ts = errorTimestamp.toISOString();
  const flushLatencyMs = computeFlushLatencyMs(state, errorTimestamp.getTime());
  state.flushStartedAtMs = undefined;
  env.sendMessage(createSnapshotResultMessage(request, ts, { ok: false, error }));
  const statusPhase = statusPhaseForState(state.status);
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
  });
  env.dispatchTelemetry(
    {
      name: 'autosave.snapshot.result',
      properties: {
        ok: false,
        status: 'failure',
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
  );
  env.sendMessage(
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
  );
  env.dispatchTelemetry(
    {
      name: 'autosave.status',
      properties: {
        state: 'error',
        correlationId: request.correlationId,
        retryCount: retryCountBeforeReset,
        phase: errorEnvelopePhase,
        performance: createFlushLatencyPerformance(flushLatencyMs),
        debounce_ms: requestDebounceMs,
        latency_ms: flushLatencyMs,
        attempt,
        phase_step: statusPhaseForState(state.status)
      }
    },
    { before: previousStatus, after: state.status, guard: guardForTelemetry }
  );
  const statusBeforeDisable = state.status;
  state.status = 'disabled';
  state.guard = {
    featureFlag: state.guard.featureFlag,
    optionsDisabled: true
  };
  env.sendMessage(
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
  );
  env.dispatchTelemetry(
    {
      name: 'autosave.status',
      properties: {
        state: 'disabled',
        correlationId: request.correlationId,
        retryCount: retryCountBeforeReset,
        phase: PHASE_STATUS,
        performance: createFlushLatencyPerformance(flushLatencyMs),
        debounce_ms: requestDebounceMs,
        latency_ms: flushLatencyMs,
        attempt,
        phase_step: statusPhaseForState(state.status)
      }
    },
    { before: statusBeforeDisable, after: state.status, guard: state.guard }
  );
  state.retryCount = 0;
  state.forceDisabled = true;
};

export { normalizeAtomicWriteError } from './error.js';
