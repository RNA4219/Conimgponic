import type {
  AutoSaveBridgeBootstrapMessage,
  AutoSaveBridgeReadyMessage,
  AutoSaveEnvelopePhase,
  AutoSavePhaseGuardSnapshot,
  AutoSavePolicy,
  AutoSaveSnapshotRequestMessage,
  AutoSaveSnapshotResultMessage,
  AutoSaveSnapshotResultPayload,
  AutoSaveStatusMessage,
  AutoSaveStatusState
} from '../../../lib/autosave.js';
import type { FlagSnapshot } from '../../../config/index.js';

import { statusPhaseForState } from './state.js';

export const API_VERSION = 1;
export const PHASE_BOOTSTRAP: AutoSaveEnvelopePhase = 'A-0';
export const PHASE_STATUS: AutoSaveEnvelopePhase = 'A-1';
export const PHASE_SNAPSHOT: AutoSaveEnvelopePhase = 'A-2';

export const toIsoTimestamp = (clock: () => Date): string => clock().toISOString();

export const createBootstrapMessage = (
  reqId: string,
  correlationId: string,
  ts: string,
  policy: AutoSavePolicy,
  guard: AutoSavePhaseGuardSnapshot,
  flags: FlagSnapshot
): AutoSaveBridgeBootstrapMessage => ({
  type: 'bridge.bootstrap',
  apiVersion: API_VERSION,
  phase: PHASE_BOOTSTRAP,
  bridgePhase: 'bootstrap',
  reqId,
  correlationId,
  ts,
  payload: {
    version: 1,
    policy,
    guard,
    flags
  }
});

export const createBridgeReadyMessage = (
  reqId: string,
  correlationId: string,
  ts: string,
  accepted: boolean,
  reason?: string
): AutoSaveBridgeReadyMessage => ({
  type: 'bridge.ready',
  apiVersion: API_VERSION,
  phase: PHASE_BOOTSTRAP,
  bridgePhase: 'ready',
  reqId,
  correlationId,
  ts,
  payload: reason ? { accepted, reason } : { accepted }
});

export const createStatusMessage = (
  reqId: string,
  correlationId: string,
  ts: string,
  envelopePhase: AutoSaveEnvelopePhase,
  state: AutoSaveStatusState,
  guard: AutoSavePhaseGuardSnapshot,
  retryCount: number,
  lastSuccessAt: string | undefined,
  pendingBytes?: number,
  attemptOverride?: number
): AutoSaveStatusMessage => ({
  type: 'status.autosave',
  apiVersion: API_VERSION,
  phase: envelopePhase,
  bridgePhase: 'status.autosave',
  reqId,
  correlationId,
  ts,
  payload: {
    state,
    phase: statusPhaseForState(state),
    retryCount,
    lastSuccessAt,
    pendingBytes,
    guard,
    attempt: attemptOverride ?? retryCount + 1
  }
});

export const createSnapshotResultMessage = (
  request: AutoSaveSnapshotRequestMessage,
  ts: string,
  payload: AutoSaveSnapshotResultPayload
): AutoSaveSnapshotResultMessage => ({
  type: 'snapshot.result',
  apiVersion: API_VERSION,
  phase: request.phase ?? PHASE_SNAPSHOT,
  bridgePhase: 'snapshot.result',
  reqId: request.reqId,
  correlationId: request.correlationId,
  ts,
  payload
});
