import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  AUTOSAVE_POLICY,
  type AutoSaveBridgeMessage,
  type AutoSaveBridgeBootstrapMessage,
  type AutoSaveError,
  type AutoSavePhaseGuardSnapshot,
  type AutoSaveSnapshotRequestMessage,
  type AutoSaveSnapshotResultMessage,
  type AutoSaveStatusMessage,
  type AutoSaveStatusState
} from '../../src/lib/autosave'
import { resolveFlags } from '../../src/config'
import {
  createVscodeAutoSaveBridge,
  resolveCollectorPhase,
  type AutoSaveAtomicWriteResult,
  type AutoSaveTelemetryEvent,
  type AutoSaveTelemetryEventProperties,
  type AutoSaveWarnEvent,
  type AutoSaveHostBridgeOptions,
  statusPhaseForState
} from '../../src/platform/vscode/autosave'
import type {
  Day8Collector,
  Day8CollectorAutoSaveGuardEvent,
  Day8CollectorEvent,
  Day8CollectorSnapshotResultEvent
} from '../../src/telemetry/day8Collector'
import type { Storyboard } from '../../src/types'

const createDefaultFlags = () =>
  resolveFlags({ clock: () => new Date('2024-01-01T00:00:00.000Z') })

const guardEnabled: AutoSavePhaseGuardSnapshot = {
  featureFlag: { value: true, source: 'env' },
  optionsDisabled: false
}

const guardReadonly: AutoSavePhaseGuardSnapshot = {
  featureFlag: { value: true, source: 'env' },
  optionsDisabled: true
}

const guardFeatureFlagDisabled: AutoSavePhaseGuardSnapshot = {
  featureFlag: { value: false, source: 'env' },
  optionsDisabled: false
}

const guardLocalStorage: AutoSavePhaseGuardSnapshot = {
  featureFlag: { value: true, source: 'localStorage' },
  optionsDisabled: false
}

const emptyStoryboard: Storyboard = {
  id: 'sb-empty',
  title: 'Empty Storyboard',
  scenes: [],
  selection: [],
  version: 1
}

const isBootstrapMessage = (
  message: AutoSaveBridgeMessage
): message is AutoSaveBridgeBootstrapMessage => message.type === 'bridge.bootstrap'

const isStatusMessage = (
  message: AutoSaveBridgeMessage
): message is AutoSaveStatusMessage => message.type === 'status.autosave'

const isSnapshotResultMessage = (
  message: AutoSaveBridgeMessage
): message is AutoSaveSnapshotResultMessage => message.type === 'snapshot.result'

const createRequest = (
  reqId: string,
  correlationId: string,
  guard: AutoSavePhaseGuardSnapshot,
  pendingBytes: number,
  generation: number
): AutoSaveSnapshotRequestMessage => ({
  type: 'snapshot.request',
  apiVersion: 1,
  phase: 'A-2',
  bridgePhase: 'snapshot.request',
  reqId,
  correlationId,
  ts: new Date('2024-01-01T00:00:01.000Z').toISOString(),
  payload: {
    reason: 'change',
    storyboard: emptyStoryboard,
    pendingBytes,
    queuedGeneration: generation,
    debounceMs: AUTOSAVE_POLICY.debounceMs,
    idleMs: AUTOSAVE_POLICY.idleMs,
    historyLimit: AUTOSAVE_POLICY.maxGenerations,
    sizeLimit: AUTOSAVE_POLICY.maxBytes,
    guard
  }
})