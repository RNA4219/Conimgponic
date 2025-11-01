import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  synchronizeAutoSaveIntegration,
  installMergeDockAutoSaveBridge,
  watchAutoSaveStoryboardDiffs,
  type AutoSaveIntegrationContext,
} from '../../src/hooks/useAutoSaveIntegration'
import {
  DEFAULT_FLAG_SNAPSHOT,
  type AutoSaveBootstrapPlan,
} from '../../src/config'
import { AUTOSAVE_POLICY } from '../../src/lib/autosave'
import type { AutoSaveInitResult } from '../../src/lib/autosave'
import type { Storyboard } from '../../src/types'

function createStoryboard(id: string, title = 'Demo'): Storyboard {
  return { id, title, scenes: [], selection: [], version: 1, tokens: {} }
}

function createPlan(enabled: boolean): AutoSaveBootstrapPlan {
  return {
    snapshot: {
      ...DEFAULT_FLAG_SNAPSHOT,
      autosave: {
        ...DEFAULT_FLAG_SNAPSHOT.autosave,
        value: enabled,
        enabled,
        source: enabled ? 'workspace' : 'default',
        errors: [],
      },
    },
    guard: {
      featureFlag: { value: enabled, source: enabled ? 'workspace' : 'default' },
      optionsDisabled: false,
    },
    failSafePhase: 'phase-a0',
    policy: AUTOSAVE_POLICY,
    errors: [],
  }
}

test('synchronizeAutoSaveIntegration disposes runner when autosave is disabled', async () => {
  const disposed: string[] = []
  const bridgeTeardown: string[] = []
  const unsubscribeLog: string[] = []

  const runner: AutoSaveInitResult = {
    snapshot: () => ({ phase: 'idle', retryCount: 0, lastSuccessAt: 'initial' }),
    async flushNow() {},
    async dispose() {
      disposed.push('dispose')
    },
    markDirty() {},
    onEvent() {
      return () => {}
    },
  }

  const context: AutoSaveIntegrationContext = {
    store: {
      getState: () => ({ sb: createStoryboard('sb-1') }),
      subscribe: () => () => {},
    },
    runnerRef: { current: runner },
    bridgeRef: { current: () => {
      bridgeTeardown.push('detach')
    } },
    subscriptionRef: { current: () => {
      unsubscribeLog.push('unsubscribed')
    } },
  }

  const result = synchronizeAutoSaveIntegration({
    plan: createPlan(false),
    context,
    initAutoSaveImpl: () => {
      throw new Error('should not initialize autosave when disabled')
    },
    installBridge: () => {
      throw new Error('should not install bridge when disabled')
    },
    watchDiffs: () => {
      throw new Error('should not watch diffs when disabled')
    },
  })

  assert.equal(result.decision?.mode, 'manual-only')
  assert.equal(context.runnerRef.current, null)
  assert.equal(context.bridgeRef.current, null)
  assert.equal(context.subscriptionRef.current, null)
  assert.deepEqual(disposed, ['dispose'])
  assert.deepEqual(bridgeTeardown, ['detach'])
  assert.deepEqual(unsubscribeLog, ['unsubscribed'])
})

test('synchronizeAutoSaveIntegration sets up runner and bridge when autosave enabled', async () => {
  const created: string[] = []
  const detachCalls: string[] = []
  const unsubscribeCalls: string[] = []

  const runner: AutoSaveInitResult = {
    snapshot: () => ({ phase: 'idle', retryCount: 0, lastSuccessAt: 'initial' }),
    async flushNow() {},
    async dispose() {
      detachCalls.push('dispose')
    },
    markDirty(meta) {
      detachCalls.push(`mark:${meta?.pendingBytes ?? 0}`)
    },
    onEvent() {
      return () => {}
    },
  }

  let storeState = { sb: createStoryboard('sb-1') }
  const listeners = new Set<(state: { readonly sb: Storyboard }) => void>()

  const context: AutoSaveIntegrationContext = {
    store: {
      getState: () => storeState,
      subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
          unsubscribeCalls.push('unsubscribe')
        }
      },
    },
    runnerRef: { current: null },
    bridgeRef: { current: null },
    subscriptionRef: { current: null },
  }

  const result = synchronizeAutoSaveIntegration({
    plan: createPlan(true),
    context,
    initAutoSaveImpl: () => {
      created.push('runner')
      return runner
    },
    installBridge: () => {
      detachCalls.push('bridge-detached')
      return () => {
        detachCalls.push('bridge-detached')
      }
    },
  })

  assert.equal(result.decision?.mode, 'autosave')
  assert.equal(context.runnerRef.current, runner)
  assert.ok(context.bridgeRef.current, 'bridge should be registered')
  assert.ok(context.subscriptionRef.current, 'subscription should be registered')
  assert.deepEqual(created, ['runner'])

  // Trigger store change
  storeState = { sb: createStoryboard('sb-1', 'Updated') }
  for (const listener of listeners) {
    listener(storeState)
  }
  const marks = detachCalls.filter((entry) => entry.startsWith('mark:'))
  const lastMark = marks.at(-1)
  assert.equal(lastMark, `mark:${JSON.stringify(storeState.sb).length}`)

  result.cleanup?.()
  assert.equal(context.runnerRef.current, null)
  assert.equal(context.bridgeRef.current, null)
  assert.equal(context.subscriptionRef.current, null)
  assert.deepEqual(detachCalls, [
    'bridge-detached',
    'mark:' + JSON.stringify(storeState.sb).length,
    'bridge-detached',
    'dispose',
  ])
  assert.deepEqual(unsubscribeCalls, ['unsubscribe'])
})

test('installMergeDockAutoSaveBridge propagates flush updates to MergeDock window', async () => {
  let lastSuccessAt = 'initial'
  let eventHandler: (() => void) | null = null

  const runner: AutoSaveInitResult = {
    snapshot: () => ({ phase: 'idle', retryCount: 0, lastSuccessAt }),
    async flushNow() {
      lastSuccessAt = 'after-flush'
    },
    async dispose() {},
    markDirty() {},
    onEvent(handler) {
      eventHandler = handler
      return () => {
        eventHandler = null
      }
    },
  }

  const target = {} as Window & {
    __mergeDockFlushNow?: () => void
    __mergeDockAutoSaveSnapshot?: { lastSuccessAt?: string }
  }

  const detach = installMergeDockAutoSaveBridge(runner, target)

  assert.equal(target.__mergeDockAutoSaveSnapshot?.lastSuccessAt, 'initial')
  assert.ok(typeof target.__mergeDockFlushNow === 'function')

  await target.__mergeDockFlushNow?.()
  assert.equal(target.__mergeDockAutoSaveSnapshot?.lastSuccessAt, 'after-flush')

  eventHandler?.()
  assert.equal(target.__mergeDockAutoSaveSnapshot?.lastSuccessAt, 'after-flush')

  detach()
  assert.equal(target.__mergeDockFlushNow, undefined)
  assert.equal(target.__mergeDockAutoSaveSnapshot, undefined)
})

test('watchAutoSaveStoryboardDiffs marks runner dirty when storyboard changes', () => {
  const captured: number[] = []
  const runner: AutoSaveInitResult = {
    snapshot: () => ({ phase: 'idle', retryCount: 0 }),
    async flushNow() {},
    async dispose() {},
    markDirty(meta) {
      captured.push(meta?.pendingBytes ?? 0)
    },
    onEvent() {
      return () => {}
    },
  }

  let state = { sb: createStoryboard('sb-1') }
  const listeners = new Set<(payload: { readonly sb: Storyboard }) => void>()

  const store = {
    getState: () => state,
    subscribe(listener: (payload: { readonly sb: Storyboard }) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }

  const runnerRef = { current: runner }
  const unsubscribe = watchAutoSaveStoryboardDiffs(store, runnerRef, runner)

  // No changes
  for (const listener of listeners) {
    listener(state)
  }
  assert.deepEqual(captured, [])

  // Update storyboard
  const updatedState = { sb: createStoryboard('sb-1', 'Changed') }
  state = updatedState
  for (const listener of listeners) {
    listener(state)
  }
  assert.deepEqual(captured, [JSON.stringify(updatedState.sb).length])

  // Runner replaced before notification
  runnerRef.current = null
  state = { sb: createStoryboard('sb-1', 'Again') }
  for (const listener of listeners) {
    listener(state)
  }
  assert.deepEqual(captured, [JSON.stringify(updatedState.sb).length])

  unsubscribe()
  assert.equal(listeners.size, 0)
})
