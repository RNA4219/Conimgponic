import { AutoSave, AutoSaveConfig } from '../../lib/autosave'
import type {
  AutoSaveBridgeMessage,
  AutoSavePhaseGuardSnapshot,
  AutoSaveSnapshotRequestMessage,
  AutoSaveSnapshotResultPayload,
  AutoSaveStatusState
} from '../../lib/autosave'
import type { FlagSnapshot, WorkspaceConfiguration } from '../../config/index.js'

export interface AutoSaveHostBridgeOptions {
  readonly policy: AutoSaveConfig
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
  const autoSave = new AutoSave(options.policy);
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
        type: 'snapshot-result',
        reqId: request.reqId,
        correlationId: request.correlationId,
        ts: new Date().toISOString(),
        payload: payload
      });
    },
    inspectHistory: () => ({ retainedBytes: 0, generations: 0 }),
    inspectState: () => ({ lastSuccessAt: undefined, retryCount: 0, status: 'disabled', guard: {} as AutoSavePhaseGuardSnapshot })
  }
}
