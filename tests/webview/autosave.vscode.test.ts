import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  AUTOSAVE_POLICY,
  type AutoSaveBridgeMessage,
  type AutoSavePhaseGuardSnapshot,
  type AutoSaveSnapshotRequestMessage,
  type AutoSaveSnapshotResultMessage,
  type AutoSaveStatusMessage
} from '../../src/lib/autosave'
import { resolveFlags } from '../../src/config'
import { createVscodeAutoSaveBridge, type AutoSaveAtomicWriteResult } from '../../src/platform/vscode/autosave'

const guardEnabled: AutoSavePhaseGuardSnapshot = {
  featureFlag: { value: true, source: 'env' },
  optionsDisabled: false
}

const guardReadonly: AutoSavePhaseGuardSnapshot = {
  featureFlag: { value: true, source: 'env' },
  optionsDisabled: true
}

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
    storyboard: { nodes: [] } as any,
    pendingBytes,
    queuedGeneration: generation,
    debounceMs: AUTOSAVE_POLICY.debounceMs,
    idleMs: AUTOSAVE_POLICY.idleMs,
    historyLimit: AUTOSAVE_POLICY.maxGenerations,
    sizeLimit: AUTOSAVE_POLICY.maxBytes,
    guard
  }
})

describe('createVscodeAutoSaveBridge', () => {
  it('bootstrap で workspace 由来の FlagSnapshot を伝搬する', () => {
    const workspace = {
      get: (key: string): unknown => {
        if (key === 'conimg.autosave.enabled') {
          return 'false'
        }
        if (key === 'conimg.merge.threshold') {
          return 'beta'
        }
        return undefined
      }
    }
    const sent: AutoSaveBridgeMessage[] = []
    const snapshot = resolveFlags({
      workspace,
      storage: null,
      env: {},
      clock: () => new Date('2024-01-02T00:00:00.000Z')
    })
    const expectedGuard: AutoSavePhaseGuardSnapshot = {
      featureFlag: {
        value: snapshot.autosave.value,
        source: snapshot.autosave.source
      },
      optionsDisabled: !snapshot.autosave.value
    }

    createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: expectedGuard,
      now: () => new Date('2024-01-02T00:00:00.000Z'),
      sendMessage: (message) => sent.push(message),
      atomicWrite: async () => {
        throw new Error('bootstrap で atomicWrite を呼ばない')
      }
    })

    const bootstrap = sent.find((message) => message.type === 'bridge.bootstrap') as any
    assert.ok(bootstrap, 'workspace 由来の FlagSnapshot を含む bootstrap メッセージが必要')
    assert.equal(bootstrap.payload.guard.featureFlag.value, expectedGuard.featureFlag.value)
    assert.equal(bootstrap.payload.guard.featureFlag.source, expectedGuard.featureFlag.source)
    assert.equal(bootstrap.payload.flags.autosave.value, snapshot.autosave.value)
    assert.equal(bootstrap.payload.flags.autosave.source, snapshot.autosave.source)
    assert.equal(bootstrap.payload.flags.merge.source, snapshot.merge.source)
  })

  it('emits dirty→saving→saved status transitions with atomic write', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    const telemetry: any[] = []
    let tick = 0
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      now: () => {
        const ts = new Date('2024-01-01T00:00:00.000Z')
        ts.setMilliseconds(tick * 250)
        tick += 1
        return ts
      },
      sendMessage: (message) => sent.push(message),
      atomicWrite: async () => ({
        ok: true,
        bytes: 2048,
        generation: 1,
        lastSuccessAt: new Date('2024-01-01T00:00:02.000Z').toISOString(),
        lockStrategy: 'web-lock'
      }),
      telemetry: (event) => telemetry.push(event)
    })

    bridge.reportDirty(2048, guardEnabled)
    const request = createRequest('req-1', 'corr-1', guardEnabled, 2048, 1)
    await bridge.handleSnapshotRequest(request)

    const statuses = sent.filter((msg): msg is AutoSaveStatusMessage => msg.type === 'status.autosave')
    assert.deepEqual(
      statuses.map((msg) => msg.payload.state),
      ['dirty', 'saving', 'saved'],
      'status state progression should follow dirty→saving→saved'
    )
    const savingStatus = statuses.find((msg) => msg.payload.state === 'saving')
    assert.equal(savingStatus?.reqId, request.reqId)
    assert.equal(savingStatus?.correlationId, request.correlationId)
    assert.equal(savingStatus?.phase, 'A-2')
    assert.equal(savingStatus?.apiVersion, 1)
    const result = sent.find((msg) => msg.type === 'snapshot.result') as AutoSaveSnapshotResultMessage | undefined
    assert.ok(result, 'snapshot.result message must be sent')
    if (result.payload.ok !== true) {
      assert.fail('snapshot.result should be ok=true')
    }
    assert.equal(result.correlationId, request.correlationId)
    assert.equal(result.phase, 'A-2')
    assert.equal(result.apiVersion, 1)
    assert.equal(result.payload.retainedBytes, 2048)
    assert.ok(
      telemetry.filter((event: any) => event.name === 'autosave.status').length >= 3,
      'telemetry autosave.status should be emitted for each transition'
    )
  })

  it('enforces history max generations and size limit', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (msg) => sent.push(msg),
      atomicWrite: async ({ request }) => ({
        ok: true,
        bytes: request.payload.pendingBytes,
        generation: request.payload.queuedGeneration,
        lastSuccessAt: new Date('2024-01-01T00:00:02.000Z').toISOString(),
        lockStrategy: 'web-lock'
      })
    })

    for (let i = 0; i < 25; i++) {
      bridge.reportDirty(3 * 1024 * 1024, guardEnabled)
      await bridge.handleSnapshotRequest(
        createRequest(`req-${i}`, `corr-${i}`, guardEnabled, 3 * 1024 * 1024, i + 1)
      )
    }

    const history = bridge.inspectHistory()
    assert.ok(history.generations <= AUTOSAVE_POLICY.maxGenerations)
    assert.ok(history.retainedBytes <= AUTOSAVE_POLICY.maxBytes)
    const lastResult = sent.filter((msg): msg is AutoSaveSnapshotResultMessage => msg.type === 'snapshot.result').at(-1)
    assert.ok(lastResult, 'final snapshot.result must exist')
    if (lastResult.payload.ok !== true) {
      assert.fail('final snapshot.result should be ok')
    }
    assert.equal(lastResult.payload.retainedBytes, history.retainedBytes)
  })

  it('downgrades to disabled when non-retryable error occurs', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (msg) => sent.push(msg),
      atomicWrite: async () => ({
        ok: false,
        error: { name: 'AutoSaveError', message: 'corrupted', code: 'data-corrupted', retryable: false }
      })
    })

    bridge.reportDirty(1024, guardEnabled)
    await bridge.handleSnapshotRequest(createRequest('req-error', 'corr-error', guardEnabled, 1024, 1))

    const result = sent.find((msg) => msg.type === 'snapshot.result') as AutoSaveSnapshotResultMessage | undefined
    assert.ok(result, 'snapshot.result must exist on failure')
    if (result.payload.ok !== false) {
      assert.fail('snapshot.result should be ok=false when error occurs')
    }
    const statuses = sent.filter((msg): msg is AutoSaveStatusMessage => msg.type === 'status.autosave')
    assert.deepEqual(statuses.map((msg) => msg.payload.state).slice(-2), ['error', 'disabled'])
    assert.equal(statuses.at(-1)?.payload.guard.optionsDisabled, true)
  })

  it('emits warn telemetry when file-lock fallback is used', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    const warns: any[] = []
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (msg) => sent.push(msg),
      atomicWrite: async () => ({
        ok: true,
        bytes: 4096,
        generation: 1,
        lastSuccessAt: new Date('2024-01-01T00:00:02.000Z').toISOString(),
        lockStrategy: 'file-lock'
      }),
      warn: (event) => warns.push(event)
    })

    bridge.reportDirty(4096, guardEnabled)
    await bridge.handleSnapshotRequest(createRequest('req-fallback', 'corr-fallback', guardEnabled, 4096, 1))
    assert.equal(warns.length, 1)
    assert.equal(warns[0].code, 'autosave.lock.fallback')
    assert.equal(warns[0].details?.correlationId, 'corr-fallback')
  })

  it('short-circuits snapshot when guard disables autosave', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardReadonly,
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (msg) => sent.push(msg),
      atomicWrite: async (): Promise<AutoSaveAtomicWriteResult> => {
        throw new Error('should not write when disabled')
      }
    })

    bridge.reportDirty(512, guardReadonly)
    await bridge.handleSnapshotRequest(createRequest('req-disabled', 'corr-disabled', guardReadonly, 512, 1))

    const result = sent.find((msg) => msg.type === 'snapshot.result') as AutoSaveSnapshotResultMessage | undefined
    assert.ok(result, 'disabled snapshot should emit snapshot.result')
    if (result.payload.ok !== false) {
      assert.fail('disabled snapshot should return ok=false')
    }
    assert.equal(result.payload.error.code, 'disabled')
    const status = sent.filter((msg): msg is AutoSaveStatusMessage => msg.type === 'status.autosave').at(-1)
    assert.equal(status?.payload.state, 'disabled')
  })
})
