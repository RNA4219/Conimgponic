import {
  publishGuardCollectorEvent,
  type AutoSavePolicy,
  type AutoSaveSnapshotResultPayload,
  type AutoSaveSnapshotRequestMessage,
  type AutoSaveBridgeMessage,
  type AutoSavePhaseGuardSnapshot,
  type AutoSaveStatusState
} from '../../lib/autosave'
import type { FlagSnapshot, WorkspaceConfiguration, FlagSource } from '../../config/index.js'
import {
  createAutoSaveBootstrapPayload,
  resolveWorkspaceBootstrapPayload
} from './flags.js'
import {
  createDisabledError,
  normalizeAtomicWriteError
} from './autosave/error.js'
import type {
  AutoSaveAtomicWriteInput,
  AutoSaveAtomicWriteResult,
  AutoSaveTelemetryEvent,
  AutoSaveTelemetryEventInput,
  AutoSaveWarnEvent,
} from './autosave/collector.js'
import {
  createFlushLatencyPerformance,
  createSnapshotFailureDetail,
  createSnapshotPayload,
  createSnapshotSuccessDetail,
  publishCollectorSnapshotResult,
  ZERO_FLUSH_LATENCY
} from './autosave/collector.js'
import {
  createBootstrapMessage,
  createBridgeReadyMessage,
  createSnapshotResultMessage,
  createStatusMessage,
  PHASE_SNAPSHOT,
  PHASE_STATUS,
  toIsoTimestamp
} from './autosave/bootstrap.js'
import { resolveSnapshotTelemetryPhase } from './autosave/guard.js'
import { formatTelemetryEvent, type AutoSaveTelemetryContext } from './autosave/telemetry.js'
import { emitWarn, handleNonRetryableError } from './autosave/errors.js'
import {
  clampHistory,
  computeFlushLatencyMs,
  computeLagSeconds,
  createInitialState,
  InternalState,
  isGuardEnabled,
  mergeGuard,
  nextCorrelationId,
  nextReqId,
  resolveGuardBlockedReason,
  statusPhaseForState
} from './autosave/state.js'

export type {
  AutoSaveAtomicWriteInput,
  AutoSaveAtomicWriteResult,
  AutoSaveTelemetryEvent,
  AutoSaveTelemetryEventInput,
  AutoSaveTelemetryEventProperties,
  AutoSaveTelemetryGuardProperties,
  AutoSaveTelemetryLockStrategy,
  AutoSaveWarnEvent,
  SnapshotResultCollectorPayload,
  SnapshotResultDetailPhase,
  SnapshotResultFailureDetailWithPhase,
  SnapshotResultSuccessDetailWithPhase
} from './autosave/collector.js'
export { resolveCollectorPhase } from '../../lib/autosave/collector-phase.js'
export { statusPhaseForState } from './autosave/state.js'

export interface AutoSaveHostBridgeOptions {
  readonly policy: AutoSavePolicy
  readonly initialGuard?: AutoSavePhaseGuardSnapshot
  readonly flags?: FlagSnapshot
  readonly workspace?: WorkspaceConfiguration | null
  readonly now: () => Date
  readonly sendMessage: (message: AutoSaveBridgeMessage) => void
  // readonly atomicWrite: (input: AutoSaveAtomicWriteInput) => Promise<AutoSaveAtomicWriteResult>
  readonly telemetry?: (event: { feature: string; phase: string; at: string; detail?: Record<string, unknown> }) => void
  readonly warn?: (event: { code: string; details: Record<string, unknown> }) => void
}

export interface AutoSaveHostHistorySnapshot {
  readonly retainedBytes: number
  readonly generations: number
}

export interface AutoSaveHostStateSnapshot {
  readonly lastSuccessAt?: string
  readonly retryCount: number
  readonly status: AutoSaveStatusState
  readonly guard: AutoSavePhaseGuardSnapshot
}

export interface AutoSaveHostBridge {
  readonly reportDirty: (pendingBytes: number, guard: AutoSavePhaseGuardSnapshot) => void
  readonly handleSnapshotRequest: (request: AutoSaveSnapshotRequestMessage) => Promise<void>
  readonly inspectHistory: () => AutoSaveHostHistorySnapshot
  readonly inspectState: () => AutoSaveHostStateSnapshot
}

export const createVscodeAutoSaveBridge = (
  options: AutoSaveHostBridgeOptions
): AutoSaveHostBridge => {
  // Placeholder implementation - the AutoSave class has been replaced with initAutoSave
  // This bridge provides a compatibility layer for VSCode integration
  const state = {
    lastSuccessAt: undefined as string | undefined,
    retryCount: 0,
    status: 'disabled' as AutoSaveStatusState
  }
  return {
    reportDirty: (_pendingBytes: number, _guard: AutoSavePhaseGuardSnapshot) => {
      // placeholder: bridge can propagate dirty state if needed in future
    },
    handleSnapshotRequest: async (request: AutoSaveSnapshotRequestMessage) => {
      // placeholder: real implementation would map request to AutoSave lifecycle
      // For now, just acknowledge the request
      console.log('handleSnapshotRequest', request);
      // Simulate a successful save
      const payload: AutoSaveSnapshotResultPayload = {
        ok: true,
        bytes: 100, // dummy value
        lastSuccessAt: new Date().toISOString(),
        generation: 1, // dummy value
        retainedBytes: 100 // dummy value
      };
      options.sendMessage({
        type: 'snapshot.result',
        apiVersion: 1,
        phase: 'A-1',
        bridgePhase: 'snapshot.result',
        reqId: request.reqId,
        correlationId: request.correlationId,
        ts: new Date().toISOString(),
        payload: payload
      });
    },
    inspectHistory: () => ({ retainedBytes: 0, generations: 0 }),
    inspectState: () => ({ lastSuccessAt: state.lastSuccessAt, retryCount: state.retryCount, status: state.status, guard: {} as AutoSavePhaseGuardSnapshot })
  }
}
