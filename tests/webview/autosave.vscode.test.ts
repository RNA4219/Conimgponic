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
  type AutoSaveStatusMessage
} from '../../src/lib/autosave'
import { resolveFlags } from '../../src/config'
import {
  createVscodeAutoSaveBridge,
  type AutoSaveAtomicWriteResult,
  type AutoSaveTelemetryEvent,
  type AutoSaveTelemetryEventProperties,
  type AutoSaveWarnEvent
} from '../../src/platform/vscode/autosave'
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

describe('createVscodeAutoSaveBridge', () => {
  it('bootstrap で workspace 由来の FlagSnapshot を伝搬する', () => {
    const workspace = {
      get: (key: string): unknown => {
        assert.ok(
          !key.startsWith('conimg.'),
          'workspace.get は AUTOSAVE-DESIGN-IMPL §3.6 と MERGE-DESIGN-IMPL §5.4 の要件通り接頭辞なしキーのみを受け付ける'
        )
        if (key === 'autosave.enabled') {
          return 'false'
        }
        if (key === 'merge.threshold') {
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

    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: expectedGuard,
      workspace,
      now: () => new Date('2024-01-02T00:00:00.000Z'),
      sendMessage: (message) => sent.push(message),
      atomicWrite: async () => {
        throw new Error('bootstrap で atomicWrite を呼ばない')
      }
    })

    assert.equal(sent.length, 1, 'create 時に送る初回メッセージは bridge.bootstrap のみ')
    const bootstrap = sent[0]
    assert.ok(bootstrap && isBootstrapMessage(bootstrap), 'bridge.bootstrap メッセージが必要')
    assert.equal(bootstrap.payload.version, 1)
    assert.strictEqual(
      bootstrap.payload.policy,
      AUTOSAVE_POLICY,
      '初期化時に保存ポリシーを Webview に伝搬する'
    )
    assert.deepEqual(
      bootstrap.payload.flags,
      snapshot,
      'resolveFlags の結果をそのまま flags として送出する'
    )
    assert.strictEqual(
      bootstrap.payload.guard,
      expectedGuard,
      'initialGuard を bridge.bootstrap で共有する'
    )
    assert.deepEqual(
      bootstrap.payload.guard,
      {
        featureFlag: {
          value: snapshot.autosave.value,
          source: snapshot.autosave.source
        },
        optionsDisabled: !snapshot.autosave.value
      },
      'guard は resolveFlags のスナップショットと一致する必要がある'
    )
    assert.equal(bootstrap.payload.flags.autosave.value, snapshot.autosave.value)
    assert.equal(bootstrap.payload.flags.autosave.source, snapshot.autosave.source)
    assert.equal(bootstrap.payload.flags.merge.source, snapshot.merge.source)

    const state = bridge.inspectState()
    assert.strictEqual(state.guard, expectedGuard, 'ブートストラップ後の guard 状態は initialGuard と一致する')
  })

  it('resolveFlags は VS Code の conimg スコープ設定を workspace source として扱う', () => {
    // VS Code mock は docs/AUTOSAVE-DESIGN-IMPL.md §3.2/§3.6 と docs/MERGE-DESIGN-IMPL.md §5.4 の前提に従い、
    // getConfiguration('conimg').get('autosave.enabled') のみを提供する。
    const workspaceConfig = {
      get: (key: string): unknown => (key === 'autosave.enabled' ? 'false' : undefined)
    }
    const vscode = {
      workspace: {
        getConfiguration: (section: string) => {
          assert.equal(section, 'conimg', 'autosave は conimg セクションに格納される')
          return workspaceConfig
        }
      }
    }
    const originalVscode = Object.getOwnPropertyDescriptor(globalThis, 'vscode')
    Object.defineProperty(globalThis, 'vscode', { value: vscode, configurable: true })
    try {
      const snapshot = resolveFlags({
        workspace: vscode.workspace.getConfiguration('conimg'),
        env: {},
        storage: null,
        clock: () => new Date('2024-01-04T00:00:00.000Z')
      })
      assert.equal(snapshot.autosave.source, 'workspace')
      assert.equal(snapshot.autosave.value, false)
    } finally {
      if (originalVscode) {
        Object.defineProperty(globalThis, 'vscode', originalVscode)
      } else {
        delete (globalThis as any).vscode
      }
    }
  })

  it('flags オプション未指定でも bootstrap で解決済み FlagSnapshot を共有する', () => {
    const sent: AutoSaveBridgeMessage[] = []
    const now = () => new Date('2024-01-03T00:00:00.000Z')
    const expectedFlags = resolveFlags({ clock: now })
    const expectedGuard: AutoSavePhaseGuardSnapshot = {
      featureFlag: {
        value: expectedFlags.autosave.value,
        source: expectedFlags.autosave.source
      },
      optionsDisabled: !expectedFlags.autosave.value
    }

    createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: expectedGuard,
      now,
      sendMessage: (message) => sent.push(message),
      atomicWrite: async () => {
        throw new Error('bootstrap で atomicWrite を呼ばない')
      }
    })

    assert.equal(sent.length, 1, 'bridge.bootstrap メッセージが 1 件送出される')
    const bootstrap = sent[0]
    assert.ok(bootstrap && isBootstrapMessage(bootstrap), '初回メッセージは bridge.bootstrap')
    assert.deepEqual(
      bootstrap.payload.flags,
      expectedFlags,
      'flags 未指定時も resolveFlags のスナップショットを共有する'
    )
  })

  it('emits dirty→saving→saved status transitions with atomic write', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    const telemetry: AutoSaveTelemetryEvent[] = []
    let tick = 0
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
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
      telemetry.filter((event) => event.name === 'autosave.status').length >= 3,
      'telemetry autosave.status should be emitted for each transition'
    )
  })

  it('returns ok=true for consecutive snapshot requests after mid-flight dirty reports', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    let writeCount = 0
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (message) => sent.push(message),
      atomicWrite: async () => {
        const result = {
          ok: true as const,
          bytes: 1024 + writeCount * 512,
          generation: writeCount,
          lastSuccessAt: new Date(Date.UTC(2024, 0, 1, 0, 0, writeCount)).toISOString(),
          lockStrategy: 'web-lock' as const
        }
        writeCount += 1
        return result
      }
    })

    bridge.reportDirty(1024, guardEnabled)
    await bridge.handleSnapshotRequest(createRequest('req-1', 'corr-1', guardEnabled, 1024, 0))

    bridge.reportDirty(1536, guardEnabled)
    await bridge.handleSnapshotRequest(createRequest('req-2', 'corr-2', guardEnabled, 1536, 1))

    const results = sent.filter((msg): msg is AutoSaveSnapshotResultMessage => msg.type === 'snapshot.result')
    const okGenerations = results
      .filter((message) => message.payload.ok)
      .map((message) => message.payload.generation)

    assert.deepEqual(okGenerations, [0, 1])
  })

  it('replays dirty→saving→saved transitions when requests queue during atomic write', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    const completions: Array<() => void> = []
    let tick = 0
    let generation = 0
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => {
        const ts = new Date('2024-01-01T00:00:00.000Z')
        ts.setMilliseconds(tick * 200)
        tick += 1
        return ts
      },
      sendMessage: (message) => sent.push(message),
      atomicWrite: async () =>
        await new Promise<AutoSaveAtomicWriteResult>((resolve) => {
          generation += 1
          completions.push(() =>
            resolve({
              ok: true,
              bytes: 1024 * generation,
              generation,
              lastSuccessAt: new Date('2024-01-01T00:00:05.000Z').toISOString(),
              lockStrategy: 'web-lock'
            })
          )
        })
    })

    bridge.reportDirty(1024, guardEnabled)
    const firstRequest = createRequest('req-1', 'corr-1', guardEnabled, 1024, 1)
    const pendingFirst = bridge.handleSnapshotRequest(firstRequest)
    await Promise.resolve()
    assert.equal(completions.length, 1)

    bridge.reportDirty(2048, guardEnabled)
    const secondRequest = createRequest('req-2', 'corr-2', guardEnabled, 2048, 2)
    const pendingSecond = bridge.handleSnapshotRequest(secondRequest)
    await Promise.resolve()
    assert.equal(completions.length, 2)

    completions.shift()?.()
    await pendingFirst
    completions.shift()?.()
    await pendingSecond

    const statuses = sent.filter((msg): msg is AutoSaveStatusMessage => msg.type === 'status.autosave')
    assert.deepEqual(
      statuses.map((msg) => msg.payload.state),
      ['dirty', 'saving', 'dirty', 'saving', 'saved', 'saved'],
      'status states should emit two cycles resulting in two saved events'
    )
    const results = sent.filter((msg): msg is AutoSaveSnapshotResultMessage => msg.type === 'snapshot.result')
    assert.equal(results.length, 2)
    assert.deepEqual(
      results.map((msg) => msg.correlationId),
      ['corr-1', 'corr-2'],
      'snapshot.result should be emitted for both requests'
    )
  })

  it('Collector telemetry に Phase/Lock/Flag メタデータを付与する', async () => {
    const telemetry: AutoSaveTelemetryEvent[] = []
    let tick = 0
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => {
        const ts = new Date('2024-01-01T00:00:00.000Z')
        ts.setMilliseconds(tick * 250)
        tick += 1
        return ts
      },
      sendMessage: () => {},
      atomicWrite: async () => ({
        ok: true,
        bytes: 4096,
        generation: 2,
        lastSuccessAt: new Date('2024-01-01T00:00:03.000Z').toISOString(),
        lockStrategy: 'web-lock'
      }),
      telemetry: (event) => telemetry.push(event)
    })

    bridge.reportDirty(4096, guardEnabled)
    await bridge.handleSnapshotRequest(
      createRequest('req-meta', 'corr-meta', guardEnabled, 4096, 2)
    )

    const dirtyEvent = telemetry.find(
      (event) => event.name === 'autosave.status' && event.properties?.state === 'dirty'
    )
    assert.ok(dirtyEvent, 'reportDirty の autosave.status telemetry が必要')
    assert.equal(dirtyEvent.properties?.phaseBefore, 'idle')
    assert.equal(dirtyEvent.properties?.phaseAfter, 'debouncing')
    assert.equal(dirtyEvent.properties?.flagSource, guardEnabled.featureFlag.source)
    assert.equal(dirtyEvent.properties?.lockStrategy, 'none')

    const resultEvent = telemetry.find(
      (event) => event.name === 'autosave.snapshot.result' && event.properties?.ok === true
    )
    assert.ok(resultEvent, 'handleSnapshotRequest の snapshot.result telemetry が必要')
    assert.equal(resultEvent.properties?.phaseBefore, 'awaiting-lock')
    assert.equal(resultEvent.properties?.phaseAfter, 'idle')
    assert.equal(resultEvent.properties?.flagSource, guardEnabled.featureFlag.source)
    assert.equal(resultEvent.properties?.lockStrategy, 'web-lock')
  })

  it('reportDirty/handleSnapshotRequest telemetry carries phase metadata', async () => {
    const telemetry: AutoSaveTelemetryEvent[] = []
    let tick = 0
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => {
        const ts = new Date('2024-01-01T00:00:00.000Z')
        ts.setMilliseconds(tick * 250)
        tick += 1
        return ts
      },
      sendMessage: () => {},
      atomicWrite: async () => ({
        ok: true,
        bytes: 2048,
        generation: 3,
        lastSuccessAt: new Date('2024-01-01T00:00:04.000Z').toISOString(),
        lockStrategy: 'web-lock'
      }),
      telemetry: (event) => telemetry.push(event)
    })

    bridge.reportDirty(2048, guardEnabled)
    await bridge.handleSnapshotRequest(
      createRequest('req-phase', 'corr-phase', guardEnabled, 2048, 3)
    )

    const expectPhases = (
      event: AutoSaveTelemetryEvent | undefined,
      phases: { before: AutoSaveTelemetryEventProperties['phaseBefore']; after: AutoSaveTelemetryEventProperties['phaseAfter']; lock: AutoSaveTelemetryEventProperties['lockStrategy'] }
    ): void => {
      assert.ok(event, 'telemetry event should exist')
      assert.equal(event.properties?.phaseBefore, phases.before)
      assert.equal(event.properties?.phaseAfter, phases.after)
      assert.equal(event.properties?.flagSource, guardEnabled.featureFlag.source)
      assert.equal(event.properties?.lockStrategy, phases.lock)
    }

    const dirtyEvent = telemetry.find(
      (event) => event.name === 'autosave.status' && event.properties?.state === 'dirty'
    )
    expectPhases(dirtyEvent, { before: 'idle', after: 'debouncing', lock: 'none' })

    const savingEvent = telemetry.find(
      (event) => event.name === 'autosave.status' && event.properties?.state === 'saving'
    )
    expectPhases(savingEvent, { before: 'debouncing', after: 'awaiting-lock', lock: 'none' })

    const resultEvent = telemetry.find(
      (event) => event.name === 'autosave.snapshot.result' && event.properties?.ok === true
    )
    expectPhases(resultEvent, { before: 'awaiting-lock', after: 'idle', lock: 'web-lock' })

    const savedEvent = telemetry.find(
      (event) => event.name === 'autosave.status' && event.properties?.state === 'saved'
    )
    expectPhases(savedEvent, { before: 'awaiting-lock', after: 'idle', lock: 'web-lock' })
  })

  it('autosave.status telemetry includes retryCount for dirty/saving/backoff/saved/disabled', async () => {
    const telemetry: AutoSaveTelemetryEvent[] = []
    let attempt = 0
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: () => {},
      atomicWrite: async () => {
        attempt += 1
        if (attempt === 1) throw Object.assign(new Error('opfs busy'), { name: 'InvalidStateError' })
        return {
          ok: true as const,
          bytes: 1024,
          generation: attempt,
          lastSuccessAt: new Date('2024-01-01T00:00:05.000Z').toISOString(),
          lockStrategy: 'web-lock' as const
        }
      },
      telemetry: telemetry.push.bind(telemetry)
    })
    const status = (
      state: AutoSaveStatusMessage['payload']['state'],
      correlationId?: string,
      predicate?: (event: AutoSaveTelemetryEvent) => boolean
    ) =>
      telemetry.find(
        (event) =>
          event.name === 'autosave.status' &&
          event.properties?.state === state &&
          (correlationId === undefined || event.properties?.correlationId === correlationId) &&
          (predicate ? predicate(event) : true)
      )

    bridge.reportDirty(256, guardReadonly)
    const disabledByGuard = status('disabled', undefined, (event) => event.properties?.source === 'phase-guard')
    assert.ok(disabledByGuard, 'phase guard disabled telemetry is required')
    assert.equal(disabledByGuard.properties?.retryCount, 0)
    assert.equal(disabledByGuard.properties?.detail?.retry_count, 0)

    bridge.reportDirty(1024, guardEnabled)
    const dirtyEvent = status('dirty', undefined, (event) => event.properties?.pendingBytes === 1024)
    assert.ok(dirtyEvent, 'dirty telemetry should exist')
    assert.equal(dirtyEvent.properties?.retryCount, 0)
    assert.equal(dirtyEvent.properties?.detail?.retry_count, 0)

    const retryRequest = createRequest('req-retry', 'corr-retry', guardEnabled, 1024, 1)
    await bridge.handleSnapshotRequest(retryRequest)
    const savingEvent = status('saving', 'corr-retry')
    assert.ok(savingEvent, 'saving telemetry should exist for retry request')
    assert.equal(savingEvent.properties?.retryCount, 0)
    assert.equal(savingEvent.properties?.detail?.retry_count, 0)
    const backoffEvent = status('backoff', 'corr-retry')
    assert.ok(backoffEvent, 'backoff telemetry should exist after retryable failure')
    assert.equal(backoffEvent.properties?.retryCount, 1)
    assert.equal(backoffEvent.properties?.detail?.retry_count, 1)
    assert.ok(backoffEvent.properties && !('attempt' in backoffEvent.properties))

    const retrySuccess = createRequest('req-success', 'corr-success', guardEnabled, 1024, 2)
    await bridge.handleSnapshotRequest(retrySuccess)
    const savingRetryEvent = status('saving', 'corr-success')
    assert.ok(savingRetryEvent, 'saving telemetry should exist for retry success')
    assert.equal(savingRetryEvent.properties?.retryCount, 1)
    assert.equal(savingRetryEvent.properties?.detail?.retry_count, 1)
    const savedEvent = status('saved', 'corr-success')
    assert.ok(savedEvent, 'saved telemetry should exist after successful retry')
    assert.equal(savedEvent.properties?.retryCount, 0)
    assert.equal(savedEvent.properties?.detail?.retry_count, 0)

    const disabledRequest = createRequest('req-disabled', 'corr-disabled', guardReadonly, 512, 3)
    await bridge.handleSnapshotRequest(disabledRequest)
    const disabledDuringRequest = status('disabled', 'corr-disabled')
    assert.ok(disabledDuringRequest, 'disabled telemetry should exist for guard-disabled request')
    assert.equal(disabledDuringRequest.properties?.retryCount, 0)
    assert.equal(disabledDuringRequest.properties?.detail?.retry_count, 0)
  })

  it('autosave.status telemetry includes request phase for saving/backoff/saved transitions', async () => {
    const telemetry: AutoSaveTelemetryEvent[] = []
    let attempt = 0
    const retryableError: AutoSaveError = {
      name: 'AutoSaveError',
      message: 'temporary failure',
      code: 'write-failed',
      retryable: true
    }
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: () => {},
      atomicWrite: async ({ request }) => {
        attempt += 1
        if (attempt === 1) {
          return { ok: false as const, error: retryableError }
        }
        return {
          ok: true as const,
          bytes: 2048,
          generation: request.payload.queuedGeneration ?? attempt,
          lastSuccessAt: new Date('2024-01-01T00:00:05.000Z').toISOString(),
          lockStrategy: 'web-lock' as const
        }
      },
      telemetry: telemetry.push.bind(telemetry)
    })

    const findStatus = (
      state: AutoSaveStatusMessage['payload']['state'],
      correlationId: string
    ) =>
      telemetry.find(
        (event) =>
          event.name === 'autosave.status' &&
          event.properties?.state === state &&
          event.properties?.correlationId === correlationId
      )

    const retryRequest: AutoSaveSnapshotRequestMessage = {
      ...createRequest('req-phase-retry', 'corr-phase-retry', guardEnabled, 1024, 1),
      phase: 'B-0'
    }
    await bridge.handleSnapshotRequest(retryRequest)

    const savingRetry = findStatus('saving', 'corr-phase-retry')
    assert.ok(savingRetry, 'saving telemetry should exist for retry request')
    assert.equal(savingRetry.properties?.phase, 'B-0')

    const backoffRetry = findStatus('backoff', 'corr-phase-retry')
    assert.ok(backoffRetry, 'backoff telemetry should exist after retryable failure')
    assert.equal(backoffRetry.properties?.phase, 'B-0')

    const successRequest: AutoSaveSnapshotRequestMessage = {
      ...createRequest('req-phase-success', 'corr-phase-success', guardEnabled, 1024, 2),
      phase: 'B-1'
    }
    await bridge.handleSnapshotRequest(successRequest)

    const savingSuccess = findStatus('saving', 'corr-phase-success')
    assert.ok(savingSuccess, 'saving telemetry should exist for success request')
    assert.equal(savingSuccess.properties?.phase, 'B-1')

    const savedSuccess = findStatus('saved', 'corr-phase-success')
    assert.ok(savedSuccess, 'saved telemetry should exist after success request')
    assert.equal(savedSuccess.properties?.phase, 'B-1')
  })

  it('autosave.status telemetry includes performance.flush_latency_ms for saving/backoff/saved/error/disabled', async () => {
    const telemetry: AutoSaveTelemetryEvent[] = []
    const recordedMessages: AutoSaveBridgeMessage[] = []
    const offsets = [0, 10, 20, 50, 70, 90, 140, 160, 180, 240], baseTs = Date.parse('2024-01-01T00:00:00.000Z')
    const now = (): Date => {
      const offset = offsets.shift()
      assert.ok(offset !== undefined, 'now timeline exhausted')
      return new Date(baseTs + offset)
    }
    let scenario: 'success' | 'retryable' | 'fatal' = 'success'
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now,
      sendMessage: (message) => recordedMessages.push(message),
      atomicWrite: async (): Promise<AutoSaveAtomicWriteResult> =>
        scenario === 'success'
          ? {
              ok: true,
              bytes: 1024,
              generation: 1,
              lastSuccessAt: new Date('2024-01-01T00:00:10.000Z').toISOString(),
              lockStrategy: 'web-lock'
            }
          : {
              ok: false,
              error: {
                name: 'AutoSaveError',
                message: scenario === 'retryable' ? 'transient failure' : 'fatal failure',
                code: scenario === 'retryable' ? 'write-failed' : 'fatal',
                retryable: scenario === 'retryable'
              }
            },
      telemetry: telemetry.push.bind(telemetry)
    })
    const scenarios: readonly [typeof scenario, string, number, number][] = [
      ['success', 'corr-success', 512, 1],
      ['retryable', 'corr-backoff', 256, 2],
      ['fatal', 'corr-fatal', 128, 3]
    ]
    for (const [mode, correlationId, pendingBytes, generation] of scenarios) {
      scenario = mode
      bridge.reportDirty(pendingBytes, guardEnabled)
      await bridge.handleSnapshotRequest(
        createRequest(`req-${mode}`, correlationId, guardEnabled, pendingBytes, generation)
      )
    }
    const expectations: readonly [AutoSaveStatusMessage['payload']['state'], string, number][] = [
      ['saved', 'corr-success', 30],
      ['backoff', 'corr-backoff', 50],
      ['error', 'corr-fatal', 60],
      ['disabled', 'corr-fatal', 60]
    ]
    const findStatusTelemetry = (
      state: AutoSaveStatusMessage['payload']['state'],
      correlationId: string
    ) =>
      telemetry.find(
        (candidate) =>
          candidate.name === 'autosave.status' &&
          candidate.properties?.state === state &&
          candidate.properties?.correlationId === correlationId
      )

    for (const [state, correlationId, latency] of expectations) {
      const event = findStatusTelemetry(state, correlationId)
      assert.equal(
        event?.properties?.performance?.flush_latency_ms,
        latency,
        `autosave.status telemetry for ${state} (${correlationId}) should include flush latency`
      )
    }

    const statusMessages = recordedMessages.filter(isStatusMessage) as AutoSaveStatusMessage[]
    const snapshotResults = recordedMessages.filter(isSnapshotResultMessage) as AutoSaveSnapshotResultMessage[]

    const durationFor = (correlationId: string): number => {
      const saving = statusMessages
        .filter((message) => message.payload.state === 'saving')
        .find((message) => message.correlationId === correlationId)
      assert.ok(saving, `saving status message for ${correlationId} is required`)
      const result = snapshotResults.find((message) => message.correlationId === correlationId)
      assert.ok(result, `snapshot.result message for ${correlationId} is required`)
      return Date.parse(result.ts) - Date.parse(saving.ts)
    }

    const durationExpectations: readonly [AutoSaveStatusMessage['payload']['state'], string][] = [
      ['saved', 'corr-success'],
      ['backoff', 'corr-backoff'],
      ['error', 'corr-fatal']
    ]

    for (const [state, correlationId] of durationExpectations) {
      const telemetryEvent = findStatusTelemetry(state, correlationId)
      assert.ok(telemetryEvent, `autosave.status telemetry for ${state} (${correlationId}) should exist`)
      assert.equal(
        telemetryEvent.properties?.performance?.flush_latency_ms,
        durationFor(correlationId),
        `flush latency for ${state} (${correlationId}) should match saving→snapshot.result duration`
      )
    }
  })

  it('enforces history max generations and size limit', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
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

  it('keeps retryable=true and backoff when atomicWrite throws DOMException', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    const telemetry: AutoSaveTelemetryEvent[] = []
    const domError =
      typeof DOMException === 'function'
        ? new DOMException('opfs-busy', 'InvalidStateError')
        : Object.assign(new Error('opfs-busy'), { name: 'InvalidStateError' })
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (msg) => sent.push(msg),
      atomicWrite: async () => {
        throw domError
      },
      telemetry: (event) => telemetry.push(event)
    })

    bridge.reportDirty(1024, guardEnabled)
    await bridge.handleSnapshotRequest(
      createRequest('req-throw', 'corr-throw', guardEnabled, 1024, 1)
    )

    const result = sent.find((msg): msg is AutoSaveSnapshotResultMessage => msg.type === 'snapshot.result')
    assert.ok(result, 'snapshot.result should be emitted for thrown errors')
    if (result.payload.ok !== false) {
      assert.fail('snapshot.result should be ok=false when atomicWrite throws')
    }
    assert.equal(result.payload.error.code, 'write-failed')
    assert.equal(result.payload.error.retryable, true)
    assert.equal(result.payload.error.cause?.name, domError.name)

    const statuses = sent.filter((msg): msg is AutoSaveStatusMessage => msg.type === 'status.autosave')
    assert.deepEqual(
      statuses.map((msg) => msg.payload.state),
      ['dirty', 'saving', 'backoff'],
      'status transitions should reach backoff after retryable failure'
    )

    const snapshotTelemetry = telemetry.find(
      (event) => event.name === 'autosave.snapshot.result' && event.properties?.correlationId === 'corr-throw'
    )
    assert.ok(snapshotTelemetry, 'snapshot.result telemetry should be recorded for thrown errors')
    assert.equal(snapshotTelemetry.properties?.retryable, true)
    assert.equal(snapshotTelemetry.properties?.code, 'write-failed')
    assert.equal(snapshotTelemetry.properties?.phaseAfter, 'backoff')
    assert.equal(snapshotTelemetry.properties?.retryCount, 1)

    const statusTelemetry = telemetry.filter(
      (event) => event.name === 'autosave.status' && event.properties?.correlationId === 'corr-throw'
    )
    assert.ok(statusTelemetry.find((event) => event.properties?.state === 'backoff'))

    const state = bridge.inspectState()
    assert.equal(state.status, 'backoff')
    assert.equal(state.retryCount, 1)
  })

  it('Collector telemetry は非 retryable エラー後に error は Phase A-2, disabled は Phase A-1 として記録する', async () => {
    const telemetry: AutoSaveTelemetryEvent[] = []
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: () => {},
      atomicWrite: async () => ({
        ok: false,
        error: {
          name: 'AutoSaveError',
          message: 'fatal',
          code: 'write-failed',
          retryable: false
        }
      }),
      telemetry: (event) => telemetry.push(event)
    })

    bridge.reportDirty(1024, guardEnabled)
    const request = createRequest('req-fatal', 'corr-fatal', guardEnabled, 1024, 1)
    await bridge.handleSnapshotRequest(request)

    const statusTelemetry = telemetry.filter(
      (event) =>
        event.name === 'autosave.status' && event.properties?.correlationId === request.correlationId
    )

    const expectPhase = (state: string, expected: string) => {
      const event = statusTelemetry.find((candidate) => candidate.properties?.state === state)
      assert.ok(event, `${state} status telemetry が必要`)
      assert.equal(event.properties?.phase, expected)
    }

    expectPhase('error', 'A-2')
    expectPhase('disabled', 'A-1')
  })

  it('autosave.status テレメトリの phase を saving/backoff/saved と guard 無効化で検証する', async () => {
    const statusTelemetry: AutoSaveTelemetryEvent[] = []
    const start = Date.parse('2024-01-01T00:00:00.000Z')
    let ticks = 0
    const now = () => new Date(start + ticks++ * 1000)
    let attempts = 0
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now,
      sendMessage: () => {},
      atomicWrite: async ({ request }) => {
        attempts += 1
        if (attempts === 1) {
          return {
            ok: false as const,
            error: {
              name: 'AutoSaveError',
              message: 'temporary lock',
              code: 'write-failed',
              retryable: true
            }
          }
        }
        return {
          ok: true as const,
          bytes: request.payload.pendingBytes,
          generation: request.payload.queuedGeneration,
          lastSuccessAt: new Date(start + 60_000).toISOString(),
          lockStrategy: 'web-lock'
        }
      },
      telemetry: (event) => statusTelemetry.push(event)
    })

    bridge.reportDirty(1024, guardEnabled)
    const retryRequest = createRequest('req-phase-retry', 'corr-phase-retry', guardEnabled, 1024, 1)
    await bridge.handleSnapshotRequest(retryRequest)

    bridge.reportDirty(1024, guardEnabled)
    const successRequest = createRequest('req-phase-success', 'corr-phase-success', guardEnabled, 1024, 2)
    await bridge.handleSnapshotRequest(successRequest)

    const statusEvents = statusTelemetry.filter((event) => event.name === 'autosave.status')
    const expectStatusPhase = (correlationId: string, state: string, expectedPhase: string) => {
      const event = statusEvents.find(
        (candidate) =>
          candidate.properties?.correlationId === correlationId && candidate.properties?.state === state
      )
      assert.ok(event, `${state} autosave.status telemetry が必要`)
      assert.equal(event.properties?.phase, expectedPhase)
    }

    expectStatusPhase(retryRequest.correlationId, 'saving', retryRequest.phase ?? 'A-2')
    expectStatusPhase(retryRequest.correlationId, 'backoff', retryRequest.phase ?? 'A-2')
    expectStatusPhase(successRequest.correlationId, 'saving', successRequest.phase ?? 'A-2')
    expectStatusPhase(successRequest.correlationId, 'saved', successRequest.phase ?? 'A-2')

    const guardTelemetry: AutoSaveTelemetryEvent[] = []
    const guardStart = Date.parse('2024-01-02T00:00:00.000Z')
    let guardTicks = 0
    const guardNow = () => new Date(guardStart + guardTicks++ * 1000)
    const guardBridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: guardNow,
      sendMessage: () => {},
      atomicWrite: async () => {
        assert.fail('guard 無効化ショートサーキットでは atomicWrite を呼ばない')
      },
      telemetry: (event) => guardTelemetry.push(event)
    })

    const guardRequest = createRequest(
      'req-guard-phase-check',
      'corr-guard-phase-check',
      { featureFlag: { value: false, source: 'env' }, optionsDisabled: true },
      0,
      0
    )
    await guardBridge.handleSnapshotRequest(guardRequest)

    const guardStatus = guardTelemetry.find(
      (event) =>
        event.name === 'autosave.status' &&
        event.properties?.correlationId === guardRequest.correlationId &&
        event.properties?.state === 'disabled'
    )
    assert.ok(guardStatus, 'guard 無効化 autosave.status テレメトリが必要')
    assert.equal(guardStatus.properties?.phase, 'A-1')
  })

  it('maintains retryCount when retrying after backoff', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    let attempt = 0
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (msg) => sent.push(msg),
      atomicWrite: async ({ request }) => {
        attempt += 1
        if (attempt === 1) {
          return {
            ok: false,
            error: {
              name: 'AutoSaveError',
              message: 'temporary lock',
              code: 'write-failed',
              retryable: true
            }
          }
        }
        return {
          ok: true,
          bytes: request.payload.pendingBytes,
          generation: request.payload.queuedGeneration,
          lastSuccessAt: new Date('2024-01-01T00:00:02.000Z').toISOString(),
          lockStrategy: 'web-lock'
        }
      }
    })

    bridge.reportDirty(2048, guardEnabled)
    await bridge.handleSnapshotRequest(
      createRequest('req-backoff-1', 'corr-backoff-1', guardEnabled, 2048, 1)
    )

    const backoffState = bridge.inspectState()
    assert.equal(backoffState.status, 'backoff')
    assert.equal(backoffState.retryCount, 1)

    bridge.reportDirty(2048, guardEnabled)
    await bridge.handleSnapshotRequest(
      createRequest('req-backoff-2', 'corr-backoff-2', guardEnabled, 2048, 2)
    )

    const retryStatuses = sent.filter(
      (msg): msg is AutoSaveStatusMessage =>
        msg.type === 'status.autosave' && msg.correlationId === 'corr-backoff-2'
    )
    const savingStatus = retryStatuses.find((msg) => msg.payload.state === 'saving')
    assert.ok(savingStatus, 'retry should emit saving status')
    assert.equal(savingStatus.payload.retryCount, 1)

    const savedStatus = retryStatuses.find((msg) => msg.payload.state === 'saved')
    assert.ok(savedStatus, 'retry should eventually save successfully')
    assert.equal(savedStatus.payload.retryCount, 0)
  })

  it('propagates retryCount when backoff transitions to non-retryable error', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    const telemetry: AutoSaveTelemetryEvent[] = []
    let attempt = 0
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (message) => sent.push(message),
      atomicWrite: async () => {
        attempt += 1
        if (attempt === 1) {
          return {
            ok: false,
            error: {
              name: 'AutoSaveError',
              message: 'temporary failure',
              code: 'write-failed',
              retryable: true
            }
          }
        }
        return {
          ok: false,
          error: {
            name: 'AutoSaveError',
            message: 'permanent failure',
            code: 'data-corrupted',
            retryable: false
          }
        }
      },
      telemetry: (event) => telemetry.push(event)
    })

    bridge.reportDirty(1024, guardEnabled)
    await bridge.handleSnapshotRequest(
      createRequest('req-backoff', 'corr-backoff', guardEnabled, 1024, 1)
    )

    const backoffState = bridge.inspectState()
    assert.equal(backoffState.status, 'backoff')
    assert.equal(backoffState.retryCount, 1)

    bridge.reportDirty(1024, guardEnabled)
    await bridge.handleSnapshotRequest(
      createRequest('req-error', 'corr-error', guardEnabled, 1024, 2)
    )

    const errorStatus = sent.find(
      (msg): msg is AutoSaveStatusMessage =>
        msg.type === 'status.autosave' &&
        msg.correlationId === 'corr-error' &&
        msg.payload.state === 'error'
    )
    assert.ok(errorStatus, 'non-retryable error should emit status.autosave error state')
    assert.equal(errorStatus.payload.retryCount, 1)

    const disabledStatus = sent.find(
      (msg): msg is AutoSaveStatusMessage =>
        msg.type === 'status.autosave' &&
        msg.correlationId === 'corr-error' &&
        msg.payload.state === 'disabled'
    )
    assert.ok(disabledStatus, 'non-retryable error should transition to disabled state')
    assert.equal(disabledStatus.payload.retryCount, 1)

    const errorTelemetry = telemetry.find(
      (event) =>
        event.name === 'autosave.status' &&
        event.properties?.state === 'error' &&
        event.properties?.correlationId === 'corr-error'
    )
    assert.ok(errorTelemetry, 'autosave.status telemetry for error state should exist')
    assert.equal(errorTelemetry.properties?.retryCount, 1)

    const disabledTelemetry = telemetry.find(
      (event) =>
        event.name === 'autosave.status' &&
        event.properties?.state === 'disabled' &&
        event.properties?.correlationId === 'corr-error'
    )
    assert.ok(disabledTelemetry, 'autosave.status telemetry for disabled state should exist')
    assert.equal(disabledTelemetry.properties?.retryCount, 1)
  })

  it('treats thrown non-retryable AutoSaveError as terminal failure', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    const telemetry: AutoSaveTelemetryEvent[] = []
    const cause = new Error('OPFS index corrupted')
    const thrown: AutoSaveError = Object.assign(new Error('Failed to persist autosave'), {
      name: 'AutoSaveError' as const,
      code: 'data-corrupted' as const,
      retryable: false,
      cause,
      context: { file: 'index.json' }
    })
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (msg) => sent.push(msg),
      atomicWrite: async () => {
        throw thrown
      },
      telemetry: (event) => telemetry.push(event)
    })

    bridge.reportDirty(1024, guardEnabled)
    await bridge.handleSnapshotRequest(
      createRequest('req-thrown', 'corr-thrown', guardEnabled, 1024, 1)
    )

    const result = sent.find(
      (msg): msg is AutoSaveSnapshotResultMessage => msg.type === 'snapshot.result'
    )
    assert.ok(result, 'snapshot.result should be emitted when atomicWrite throws')
    if (result.payload.ok !== false) {
      assert.fail('snapshot.result should contain ok=false payload for thrown error')
    }
    assert.equal(result.payload.error, thrown)
    assert.equal(result.payload.error.code, 'data-corrupted')
    assert.equal(result.payload.error.retryable, false)
    assert.equal(result.payload.error.cause, cause)
    assert.deepEqual(result.payload.error.context, { file: 'index.json' })

    const statuses = sent.filter((msg): msg is AutoSaveStatusMessage => msg.type === 'status.autosave')
    assert.deepEqual(statuses.map((msg) => msg.payload.state).slice(-2), ['error', 'disabled'])

    const snapshotTelemetry = telemetry.find(
      (event) => event.name === 'autosave.snapshot.result' && event.properties?.correlationId === 'corr-thrown'
    )
    assert.ok(snapshotTelemetry, 'snapshot.result telemetry should exist for thrown AutoSaveError')
    assert.equal(snapshotTelemetry.properties?.retryable, false)
    assert.equal(snapshotTelemetry.properties?.code, 'data-corrupted')

    const statusTelemetry = telemetry.filter(
      (event) => event.name === 'autosave.status' && event.properties?.correlationId === 'corr-thrown'
    )
    assert.ok(statusTelemetry.find((event) => event.properties?.state === 'error'))
    assert.ok(statusTelemetry.find((event) => event.properties?.state === 'disabled'))
  })

  it('disables autosave and records non-retryable telemetry when atomicWrite throws AutoSaveError', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    const telemetry: AutoSaveTelemetryEvent[] = []
    const thrown: AutoSaveError = Object.assign(new Error('index.json corrupted'), {
      name: 'AutoSaveError' as const,
      code: 'data-corrupted' as const,
      retryable: false
    })
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (msg) => sent.push(msg),
      atomicWrite: async () => {
        throw thrown
      },
      telemetry: (event) => telemetry.push(event)
    })

    bridge.reportDirty(2048, guardEnabled)
    await bridge.handleSnapshotRequest(createRequest('req-fatal', 'corr-fatal', guardEnabled, 2048, 1))

    const statuses = sent.filter((msg): msg is AutoSaveStatusMessage => msg.type === 'status.autosave')
    assert.deepEqual(
      statuses.map((msg) => msg.payload.state),
      ['dirty', 'saving', 'error', 'disabled'],
      'fatal AutoSaveError should transition to error then disabled'
    )
    assert.equal(bridge.inspectState().guard.optionsDisabled, true)

    const snapshotTelemetry = telemetry.find(
      (event) => event.name === 'autosave.snapshot.result' && event.properties?.correlationId === 'corr-fatal'
    )
    assert.ok(snapshotTelemetry, 'snapshot.result telemetry is required for fatal errors')
    assert.equal(snapshotTelemetry.properties?.retryable, false)
    assert.equal(snapshotTelemetry.properties?.code, 'data-corrupted')

    const disabledTelemetry = telemetry.find(
      (event) => event.name === 'autosave.status' && event.properties?.state === 'disabled'
    )
    assert.ok(disabledTelemetry, 'autosave.status telemetry should include disabled state for fatal errors')
    assert.equal(disabledTelemetry.properties?.phaseAfter, 'disabled')
  })

  it('fatal AutoSaveError の autosave.status disabled テレメトリで phase=A-1 を送信する', async () => {
    const telemetry: AutoSaveTelemetryEvent[] = []
    const fatalError: AutoSaveError = {
      name: 'AutoSaveError',
      message: 'corrupted',
      code: 'data-corrupted',
      retryable: false
    }
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: () => {
        /* noop */
      },
      atomicWrite: async () => ({ ok: false, error: fatalError }),
      telemetry: (event) => telemetry.push(event)
    })

    bridge.reportDirty(1024, guardEnabled)
    await bridge.handleSnapshotRequest(
      createRequest('req-fatal-phase', 'corr-fatal-phase', guardEnabled, 1024, 1)
    )

    const disabledTelemetry = telemetry.find(
      (event) =>
        event.name === 'autosave.status' &&
        event.properties?.state === 'disabled' &&
        event.properties?.correlationId === 'corr-fatal-phase'
    )
    assert.ok(disabledTelemetry, 'fatal errors must emit disabled autosave.status telemetry')
    assert.equal(disabledTelemetry.properties?.phase, 'A-1')
  })

  it('handleNonRetryableError 経路の autosave.status disabled テレメトリで phase=A-1 を送信する', async () => {
    const telemetry: AutoSaveTelemetryEvent[] = []
    const thrownError: AutoSaveError = {
      name: 'AutoSaveError',
      message: 'fatal write failure',
      code: 'write-failed',
      retryable: false
    }
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: () => {
        /* noop */
      },
      atomicWrite: async () => {
        throw thrownError
      },
      telemetry: telemetry.push.bind(telemetry)
    })

    bridge.reportDirty(2048, guardEnabled)
    const request = createRequest('req-handle-non-retryable', 'corr-handle-non-retryable', guardEnabled, 2048, 1)
    await bridge.handleSnapshotRequest(request)

    const disabledTelemetry = telemetry.find(
      (event) =>
        event.name === 'autosave.status' &&
        event.properties?.state === 'disabled' &&
        event.properties?.correlationId === request.correlationId
    )
    assert.ok(disabledTelemetry, 'handleNonRetryableError must emit disabled autosave.status telemetry')
    assert.equal(disabledTelemetry.properties?.phase, 'A-1')
  })

  it('keeps autosave disabled for queued request after fatal error', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    let writeCount = 0
    const fatalError: AutoSaveError = {
      name: 'AutoSaveError',
      message: 'corrupted',
      code: 'data-corrupted',
      retryable: false
    }
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (msg) => sent.push(msg),
      atomicWrite: async () => {
        writeCount += 1
        if (writeCount > 1) {
          throw new Error('atomicWrite must not run after fatal error')
        }
        return { ok: false, error: fatalError }
      }
    })

    bridge.reportDirty(1024, guardEnabled)
    await bridge.handleSnapshotRequest(
      createRequest('req-fatal', 'corr-fatal', guardEnabled, 1024, 1)
    )

    await bridge.handleSnapshotRequest(
      createRequest('req-queued', 'corr-queued', guardEnabled, 512, 2)
    )

    assert.equal(writeCount, 1, 'atomicWrite must not run for queued request after fatal error')
    const queuedSnapshot = sent.find(
      (msg): msg is AutoSaveSnapshotResultMessage =>
        msg.type === 'snapshot.result' && msg.correlationId === 'corr-queued'
    )
    assert.ok(queuedSnapshot, 'queued snapshot should emit snapshot.result when disabled')
    if (queuedSnapshot.payload.ok !== false) {
      assert.fail('queued snapshot should respond with ok=false payload when disabled')
    }
    assert.equal(queuedSnapshot.payload.error.code, 'disabled')

    const queuedStatuses = sent.filter(
      (msg): msg is AutoSaveStatusMessage =>
        msg.type === 'status.autosave' && msg.correlationId === 'corr-queued'
    )
    assert.deepEqual(
      queuedStatuses.map((msg) => msg.payload.state),
      ['disabled'],
      'queued request should transition directly to disabled state'
    )
    assert.ok(
      queuedStatuses.every((msg) => msg.payload.guard.optionsDisabled),
      'disabled guard must be preserved across queued requests'
    )
  })

  it('stops new snapshot.request after fatal error even if guard reports enabled', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    const telemetry: AutoSaveTelemetryEvent[] = []
    let writeCount = 0
    const fatalError: AutoSaveError = {
      name: 'AutoSaveError',
      message: 'fatal corruption',
      code: 'data-corrupted',
      retryable: false
    }
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (msg) => sent.push(msg),
      atomicWrite: async () => {
        writeCount += 1
        if (writeCount === 1) {
          return { ok: false, error: fatalError }
        }
        assert.fail('atomicWrite must not run after fatal error')
      },
      telemetry: (event) => telemetry.push(event)
    })

    bridge.reportDirty(1024, guardEnabled)
    await bridge.handleSnapshotRequest(
      createRequest('req-fatal', 'corr-fatal', guardEnabled, 1024, 1)
    )

    bridge.reportDirty(512, guardEnabled)
    await bridge.handleSnapshotRequest(
      createRequest('req-retry', 'corr-retry', guardEnabled, 512, 2)
    )

    assert.equal(writeCount, 1, 'atomicWrite must not run after fatal error')

    const retryStatuses = sent.filter(
      (msg): msg is AutoSaveStatusMessage =>
        msg.type === 'status.autosave' && msg.correlationId === 'corr-retry'
    )
    assert.deepEqual(
      retryStatuses.map((msg) => msg.payload.state),
      ['disabled'],
      'retry request should transition directly to disabled state'
    )
    assert.ok(
      retryStatuses.every((msg) => msg.payload.guard.optionsDisabled),
      'disabled guard must be preserved for retry request'
    )
    assert.equal(
      bridge.inspectState().guard.optionsDisabled,
      true,
      'guard.optionsDisabled must remain true after fatal error'
    )

    const retrySnapshotTelemetry = telemetry.find(
      (event) =>
        event.name === 'autosave.snapshot.result' &&
        event.properties?.correlationId === 'corr-retry'
    )
    assert.ok(retrySnapshotTelemetry, 'snapshot.result telemetry is required when disabled')
    assert.equal(retrySnapshotTelemetry.properties?.ok, false)
    assert.equal(retrySnapshotTelemetry.properties?.code, 'disabled')
    assert.equal(retrySnapshotTelemetry.properties?.retryable, false)

    const retryStatusTelemetry = telemetry.find(
      (event) =>
        event.name === 'autosave.status' && event.properties?.correlationId === 'corr-retry'
    )
    assert.ok(retryStatusTelemetry, 'autosave.status telemetry should include disabled state')
    assert.equal(retryStatusTelemetry.properties?.state, 'disabled')
  })

  it('keeps readonly downgrade across reportDirty/handleSnapshotRequest after fatal error', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    let writeCount = 0
    const fatalError: AutoSaveError = {
      name: 'AutoSaveError',
      message: 'fatal corruption',
      code: 'data-corrupted',
      retryable: false
    }
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (msg) => sent.push(msg),
      atomicWrite: async () => {
        writeCount += 1
        if (writeCount === 1) {
          return { ok: false, error: fatalError }
        }
        assert.fail('atomicWrite must not run after fatal error')
      }
    })

    bridge.reportDirty(1024, guardEnabled)
    await bridge.handleSnapshotRequest(
      createRequest('req-initial', 'corr-initial', guardEnabled, 1024, 1)
    )

    const messageCountBeforeRetry = sent.length
    bridge.reportDirty(2048, guardEnabled)
    const lastMessage = sent.at(-1)
    assert.ok(lastMessage && lastMessage.type === 'status.autosave', 'reportDirty should emit status.autosave')
    assert.equal(lastMessage.payload.state, 'disabled')
    assert.equal(lastMessage.payload.guard.optionsDisabled, true)

    await bridge.handleSnapshotRequest(
      createRequest('req-after', 'corr-after', guardEnabled, 2048, 2)
    )

    assert.equal(writeCount, 1, 'atomicWrite must not run after fatal error')

    const retryResult = sent
      .slice(messageCountBeforeRetry)
      .find(
        (msg): msg is AutoSaveSnapshotResultMessage =>
          msg.type === 'snapshot.result' && msg.correlationId === 'corr-after'
      )
    assert.ok(retryResult, 'snapshot.result should be emitted for disabled retry request')
    if (retryResult.payload.ok !== false) {
      assert.fail('retry snapshot should respond with ok=false payload')
    }
    assert.equal(retryResult.payload.error.code, 'disabled')
    assert.equal(retryResult.payload.error.retryable, false)

    const retryStatuses = sent
      .slice(messageCountBeforeRetry)
      .filter(
        (msg): msg is AutoSaveStatusMessage =>
          msg.type === 'status.autosave' && msg.correlationId === 'corr-after'
      )
    assert.ok(retryStatuses.length > 0, 'disabled retry should emit autosave status updates')
    assert.ok(retryStatuses.every((msg) => msg.payload.state === 'disabled'))
    assert.ok(retryStatuses.every((msg) => msg.payload.guard.optionsDisabled))
  })

  it('downgrades to disabled when non-retryable error occurs', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    const telemetry: AutoSaveTelemetryEvent[] = []
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (msg) => sent.push(msg),
      atomicWrite: async () => ({
        ok: false,
        error: { name: 'AutoSaveError', message: 'corrupted', code: 'data-corrupted', retryable: false }
      }),
      telemetry: (event) => telemetry.push(event)
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

    const statusEvents = telemetry.filter(
      (event) => event.name === 'autosave.status' && event.properties?.correlationId === 'corr-error'
    )
    assert.ok(statusEvents.find((event) => event.properties?.state === 'error'))
    assert.ok(statusEvents.find((event) => event.properties?.state === 'disabled'))
  })

  it('emits status.autosave disabled with A-1 phase after non-retryable error', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    const telemetry: AutoSaveTelemetryEvent[] = []
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (message) => sent.push(message),
      atomicWrite: async () => ({
        ok: false,
        error: {
          name: 'AutoSaveError',
          message: 'fatal',
          code: 'data-corrupted',
          retryable: false
        }
      }),
      telemetry: (event) => telemetry.push(event)
    })

    bridge.reportDirty(1024, guardEnabled)
    const request = createRequest('req-phase', 'corr-phase', guardEnabled, 1024, 1)
    await bridge.handleSnapshotRequest(request)

    const statuses = sent.filter(
      (msg): msg is AutoSaveStatusMessage =>
        msg.type === 'status.autosave' && msg.correlationId === request.correlationId
    )
    const disabledStatus = statuses.find((msg) => msg.payload.state === 'disabled')
    assert.ok(disabledStatus, 'non-retryable error should downgrade to disabled state')
    assert.equal(disabledStatus.phase, 'A-1')
    assert.equal(disabledStatus.reqId, request.reqId)
    assert.equal(disabledStatus.correlationId, request.correlationId)

    const disabledTelemetry = telemetry.find(
      (event) =>
        event.name === 'autosave.status' &&
        event.properties?.state === 'disabled' &&
        event.properties?.correlationId === request.correlationId
    )
    assert.ok(disabledTelemetry, 'disabled autosave.status telemetry must exist')
    assert.equal(disabledTelemetry.properties?.phase, 'A-1')
  })

  it('emits envelope phases A-2→A-1 when non-retryable error disables autosave', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    const telemetry: AutoSaveTelemetryEvent[] = []
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (message) => sent.push(message),
      atomicWrite: async () => ({
        ok: false,
        error: {
          name: 'AutoSaveError',
          message: 'fatal',
          code: 'data-corrupted',
          retryable: false
        }
      }),
      telemetry: (event) => telemetry.push(event)
    })

    bridge.reportDirty(2048, guardEnabled)
    const request = createRequest('req-phase-envelope', 'corr-phase-envelope', guardEnabled, 2048, 1)
    await bridge.handleSnapshotRequest(request)

    const statuses = sent.filter(
      (msg): msg is AutoSaveStatusMessage =>
        msg.type === 'status.autosave' && msg.correlationId === request.correlationId
    )
    const errorStatus = statuses.find((msg) => msg.payload.state === 'error')
    assert.ok(errorStatus, 'non-retryable error should emit error status before disabling')
    assert.equal(errorStatus.phase, request.phase)

    const disabledStatus = statuses.find((msg) => msg.payload.state === 'disabled')
    assert.ok(disabledStatus, 'non-retryable error should emit disabled status after error')
    assert.equal(disabledStatus.phase, 'A-1')

    const errorTelemetry = telemetry.find(
      (event) =>
        event.name === 'autosave.status' &&
        event.properties?.state === 'error' &&
        event.properties?.correlationId === request.correlationId
    )
    assert.ok(errorTelemetry, 'error telemetry should be recorded for non-retryable failure')
    assert.equal(errorTelemetry.properties?.phase, request.phase)

    const disabledTelemetry = telemetry.find(
      (event) =>
        event.name === 'autosave.status' &&
        event.properties?.state === 'disabled' &&
        event.properties?.correlationId === request.correlationId
    )
    assert.ok(disabledTelemetry, 'disabled telemetry should follow non-retryable failure')
    assert.equal(disabledTelemetry.properties?.phase, 'A-1')
  })

  it('emits warn telemetry when file-lock fallback is used', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    const warns: AutoSaveWarnEvent[] = []
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
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
    const telemetry: AutoSaveTelemetryEvent[] = []
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardReadonly,
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (msg) => sent.push(msg),
      atomicWrite: async (): Promise<AutoSaveAtomicWriteResult> => {
        throw new Error('should not write when disabled')
      },
      telemetry: (event) => telemetry.push(event)
    })

    bridge.reportDirty(512, guardReadonly)
    await bridge.handleSnapshotRequest(createRequest('req-disabled', 'corr-disabled', guardReadonly, 512, 1))

    const result = sent.find((msg) => msg.type === 'snapshot.result') as AutoSaveSnapshotResultMessage | undefined
    assert.ok(result, 'disabled snapshot should emit snapshot.result')
    assert.equal(result.phase, 'A-2')
    if (result.payload.ok !== false) {
      assert.fail('disabled snapshot should return ok=false')
    }
    assert.equal(result.payload.error.code, 'disabled')
    const status = sent.filter((msg): msg is AutoSaveStatusMessage => msg.type === 'status.autosave').at(-1)
    assert.equal(status?.payload.state, 'disabled')
    assert.equal(status?.phase, 'A-1')

    const statusTelemetry = telemetry.find(
      (event) => event.name === 'autosave.status' && event.properties?.correlationId === 'corr-disabled'
    )
    assert.equal(statusTelemetry?.properties?.state, 'disabled')
    assert.deepEqual(statusTelemetry?.properties?.performance, { flush_latency_ms: 0 })
  })

  it('guard disable short circuit で autosave.status テレメトリに A-1 phase を付与する', async () => {
    const sent: AutoSaveBridgeMessage[] = []
    const telemetry: AutoSaveTelemetryEvent[] = []
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (message) => sent.push(message),
      atomicWrite: async () => {
        assert.fail('guard 無効化ショートサーキットでは atomicWrite を呼ばない')
      },
      telemetry: (event) => telemetry.push(event)
    })

    const request = createRequest(
      'req-guard-phase',
      'corr-guard-phase',
      { featureFlag: { value: false, source: 'env' }, optionsDisabled: true },
      0,
      0
    )
    await bridge.handleSnapshotRequest(request)

    const nonBootstrap = sent.filter((message) => message.type !== 'bridge.bootstrap')
    assert.equal(
      nonBootstrap.length,
      2,
      'guard 無効化ショートサーキットは snapshot.result と status.autosave を送る'
    )

    const disabledTelemetry = telemetry.find(
      (event) =>
        event.name === 'autosave.status' && event.properties?.correlationId === request.correlationId
    )
    assert.ok(disabledTelemetry, 'guard 無効化テレメトリが必要')
    assert.equal(disabledTelemetry.properties?.state, 'disabled')
    assert.equal(disabledTelemetry.properties?.phase, 'A-1')
    assert.deepEqual(disabledTelemetry.properties?.performance, { flush_latency_ms: 0 })
  })

  it('guard 無効化ショートサーキットで autosave.guard telemetry を 1 度送信する', async () => {
    const telemetry: AutoSaveTelemetryEvent[] = []
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: () => {
        /* noop */
      },
      atomicWrite: async () => {
        assert.fail('guard 無効化ショートサーキットでは atomicWrite を呼ばない')
      },
      telemetry: (event) => telemetry.push(event)
    })

    const request = createRequest(
      'req-guard-telemetry',
      'corr-guard-telemetry',
      { featureFlag: { value: false, source: 'env' }, optionsDisabled: true },
      0,
      0
    )
    await bridge.handleSnapshotRequest(request)

    const guardEvents = telemetry.filter((event) => event.name === 'autosave.guard')
    assert.equal(guardEvents.length, 1, 'phase guard disable は autosave.guard telemetry を 1 回送信する')
    const guardEvent = guardEvents[0]
    assert.equal(guardEvent?.properties?.blocked, true)
    assert.equal(guardEvent?.properties?.reason, 'feature-flag-disabled')
    assert.equal(guardEvent?.properties?.correlationId, request.correlationId)
  })

  it('reportDirty の autosave.status telemetry で guard 無効化と dirty 遷移の phase を付与する', () => {
    const telemetry: AutoSaveTelemetryEvent[] = []
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: () => {
        /* noop */
      },
      atomicWrite: async () => {
        assert.fail('reportDirty テレメトリ検証では atomicWrite を呼ばない')
      },
      telemetry: (event) => telemetry.push(event)
    })

    bridge.reportDirty(256, { featureFlag: { value: false, source: 'env' }, optionsDisabled: true })
    const disabledTelemetry = telemetry.find(
      (event) => event.name === 'autosave.status' && event.properties?.state === 'disabled'
    )
    assert.ok(disabledTelemetry, 'guard 無効化テレメトリが必要')
    assert.equal(
      disabledTelemetry.properties?.phase,
      'A-1',
      "guard 無効化 autosave.status telemetry は envelope phase 'A-1' を含む"
    )
    assert.deepEqual(
      disabledTelemetry.properties?.performance,
      { flush_latency_ms: 0 },
      'guard 無効化 autosave.status telemetry は flush_latency_ms=0 を含む'
    )

    bridge.reportDirty(512, guardEnabled)
    const dirtyTelemetry = telemetry.find(
      (event) => event.name === 'autosave.status' && event.properties?.state === 'dirty'
    )
    assert.ok(dirtyTelemetry, 'dirty テレメトリが必要')
    assert.equal(
      dirtyTelemetry.properties?.phase,
      'A-1',
      "dirty autosave.status telemetry は envelope phase 'A-1' を含む"
    )
  })

  it('reportDirty の autosave.status telemetry で flush latency を 0ms として送信する', () => {
    const telemetry: AutoSaveTelemetryEvent[] = []
    const bridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: () => {
        /* noop */
      },
      atomicWrite: async () => {
        assert.fail('reportDirty テレメトリ検証では atomicWrite を呼ばない')
      },
      telemetry: (event) => telemetry.push(event)
    })

    bridge.reportDirty(512, guardEnabled)

    const dirtyTelemetry = telemetry.find(
      (event) =>
        event.name === 'autosave.status' &&
        event.properties?.state === 'dirty' &&
        event.properties?.pendingBytes === 512
    )
    assert.ok(dirtyTelemetry, 'dirty テレメトリが必要')
    assert.equal(
      dirtyTelemetry.properties?.performance?.flush_latency_ms,
      0,
      'reportDirty の autosave.status telemetry は flush_latency_ms=0 を送信する'
    )
  })

  it('guard disable short circuit と非 retryable 降格で status.envelope.phase を A-1 に揃える', async () => {
    const disabledMessages: AutoSaveBridgeMessage[] = []
    let disabledAtomicCalls = 0
    const disabledBridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (message) => disabledMessages.push(message),
      atomicWrite: async () => {
        disabledAtomicCalls += 1
        return {
          ok: false as const,
          error: {
            name: 'AutoSaveError',
            message: 'guard disabled should short-circuit',
            code: 'disabled',
            retryable: false
          }
        }
      }
    })

    const disabledRequest = createRequest(
      'req-disabled',
      'corr-disabled',
      { featureFlag: { value: false, source: 'env' }, optionsDisabled: true },
      0,
      0
    )
    await disabledBridge.handleSnapshotRequest(disabledRequest)

    const disabledStatus = disabledMessages
      .filter((message): message is AutoSaveStatusMessage => message.type === 'status.autosave')
      .find((message) => message.correlationId === disabledRequest.correlationId)

    assert.ok(disabledStatus, 'guard 無効化時に status.autosave が必要')
    assert.equal(disabledStatus.phase, 'A-1')
    assert.equal(disabledStatus.reqId, disabledRequest.reqId)
    assert.equal(disabledStatus.correlationId, disabledRequest.correlationId)
    assert.equal(disabledStatus.payload.retryCount, 0)
    assert.equal(disabledAtomicCalls, 0, 'guard 無効化ショートサーキットでは atomicWrite を呼び出さない')

    const fatalMessages: AutoSaveBridgeMessage[] = []
    const fatalBridge = createVscodeAutoSaveBridge({
      policy: AUTOSAVE_POLICY,
      initialGuard: guardEnabled,
      flags: createDefaultFlags(),
      now: () => new Date('2024-01-01T00:00:00.000Z'),
      sendMessage: (message) => fatalMessages.push(message),
      atomicWrite: async () => ({
        ok: false,
        error: {
          name: 'AutoSaveError',
          message: 'non-retryable failure',
          code: 'data-corrupted',
          retryable: false
        }
      })
    })

    const fatalRequest = createRequest('req-fatal', 'corr-fatal', guardEnabled, 1024, 1)
    await fatalBridge.handleSnapshotRequest(fatalRequest)

    const fatalStatuses = fatalMessages
      .filter((message): message is AutoSaveStatusMessage => message.type === 'status.autosave')
      .filter((message) => message.correlationId === fatalRequest.correlationId)

    const errorStatus = fatalStatuses.find((message) => message.payload.state === 'error')
    assert.ok(errorStatus, '非 retryable エラーで state=error を通知する必要がある')
    assert.equal(errorStatus.phase, 'A-2')
    assert.equal(errorStatus.reqId, fatalRequest.reqId)
    assert.equal(errorStatus.correlationId, fatalRequest.correlationId)
    assert.equal(errorStatus.payload.retryCount, 0)

    const disabledAfterError = fatalStatuses.find((message) => message.payload.state === 'disabled')
    assert.ok(disabledAfterError, '非 retryable エラー後に state=disabled を通知する必要がある')
    assert.equal(disabledAfterError.phase, 'A-1')
    assert.equal(disabledAfterError.reqId, fatalRequest.reqId)
    assert.equal(disabledAfterError.correlationId, fatalRequest.correlationId)
    assert.equal(disabledAfterError.payload.retryCount, 0)
  })
})
