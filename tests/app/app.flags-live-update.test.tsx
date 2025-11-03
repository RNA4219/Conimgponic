import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createFlagSnapshotSubscription,
  notifyFlagSnapshotRefresh,
  resolveMergeDockIntegration,
  type AutoSaveActivationDecision
} from '../../src/App'
import {
  DEFAULT_FLAG_SNAPSHOT,
  resolveAutoSaveBootstrapPlan,
  type AutoSaveBootstrapPlan,
  type FlagSnapshot,
  type MergePrecision,
  type ResolveOptions
} from '../../src/config'
import {
  synchronizeAutoSaveIntegration,
  type AutoSaveStoryboardStore
} from '../../src/hooks/useAutoSaveIntegration'
import { AUTOSAVE_POLICY, type AutoSaveInitResult } from '../../src/lib/autosave'
import type { MergeDockIntegrationSnapshot } from '../../src/App'
import type { Storyboard } from '../../src/types'

type MutableGlobal = typeof globalThis & {
  window?: Window
  document?: Document
  localStorage?: Storage
  navigator?: { userAgent: string }
}

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(String(key), String(value))
  }
}

const createStorageEvent = (key: string | null): StorageEvent => {
  const event = new Event('storage') as StorageEvent
  Object.defineProperty(event, 'key', { value: key, configurable: true })
  return event
}

test('App re-evaluates MergeDock integration when flags change live', () => {
  const scope = globalThis as MutableGlobal
  const originalWindow = scope.window
  const originalDocument = scope.document
  const originalLocalStorage = scope.localStorage

  const events = new EventTarget()
  const documentEvents = new EventTarget()
  const storage = new MemoryStorage()

  const windowMock = {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    localStorage: storage
  } as unknown as Window

  const documentMock = {
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
    dispatchEvent: documentEvents.dispatchEvent.bind(documentEvents),
    visibilityState: 'visible'
  } as unknown as Document

  scope.window = windowMock
  scope.document = documentMock
  scope.localStorage = storage

  try {
    const subscription = createFlagSnapshotSubscription(null)

    const snapshots: Array<{
      readonly plan: ReturnType<typeof resolveAutoSaveBootstrapPlan>
      readonly merge: ReturnType<typeof resolveMergeDockIntegration>
    }> = []

    const collect = () => {
      const plan = resolveAutoSaveBootstrapPlan()
      const merge = resolveMergeDockIntegration(plan, null)
      snapshots.push({ plan, merge })
    }

    collect()
    const unsubscribe = subscription.subscribe(() => {
      collect()
    })

    storage.setItem('autosave.enabled', 'true')
    windowMock.dispatchEvent(createStorageEvent('autosave.enabled'))
    documentMock.dispatchEvent(new Event('visibilitychange'))
    assert.equal(snapshots.length, 1)

    notifyFlagSnapshotRefresh()
    assert.equal(snapshots.at(-1)?.plan.snapshot.autosave.enabled, true)
    assert.equal(snapshots.length, 2)

    storage.setItem('merge.precision', 'beta')
    windowMock.dispatchEvent(createStorageEvent('merge.precision'))
    documentMock.dispatchEvent(new Event('visibilitychange'))
    assert.equal(snapshots.length, 2)

    notifyFlagSnapshotRefresh()
    assert.equal(
      snapshots.at(-1)?.merge.flagSnapshot.merge.precision,
      'beta'
    )
    assert.equal(snapshots.length, 3)

    unsubscribe()
    subscription.dispose()
  } finally {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(scope, 'window')
    } else {
      scope.window = originalWindow
    }

    if (originalDocument === undefined) {
      Reflect.deleteProperty(scope, 'document')
    } else {
      scope.document = originalDocument
    }

    if (originalLocalStorage === undefined) {
      Reflect.deleteProperty(scope, 'localStorage')
    } else {
      scope.localStorage = originalLocalStorage
    }
  }
})

test('Flag snapshot live refresh guard enables storage and visibility handlers on Phase B', () => {
  const scope = globalThis as MutableGlobal
  const originalWindow = scope.window
  const originalDocument = scope.document
  const originalLocalStorage = scope.localStorage

  const events = new EventTarget()
  const documentEvents = new EventTarget()
  const storage = new MemoryStorage()

  const windowMock = {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    localStorage: storage
  } as unknown as Window

  const documentMock = {
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
    dispatchEvent: documentEvents.dispatchEvent.bind(documentEvents),
    visibilityState: 'visible'
  } as unknown as Document

  scope.window = windowMock
  scope.document = documentMock
  scope.localStorage = storage

  try {
    const subscription = createFlagSnapshotSubscription(null, {
      liveRefreshPhase: 'phase-b0'
    })
    const snapshots: FlagSnapshot[] = [subscription.read()]
    const unsubscribe = subscription.subscribe((snapshot) => {
      snapshots.push(snapshot)
    })

    storage.setItem('autosave.enabled', 'true')
    windowMock.dispatchEvent(createStorageEvent('autosave.enabled'))
    assert.equal(snapshots.length, 2)

    storage.setItem('merge.precision', 'beta')
    documentMock.dispatchEvent(new Event('visibilitychange'))
    assert.equal(snapshots.length, 3)

    unsubscribe()
    subscription.dispose()
  } finally {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(scope, 'window')
    } else {
      scope.window = originalWindow
    }

    if (originalDocument === undefined) {
      Reflect.deleteProperty(scope, 'document')
    } else {
      scope.document = originalDocument
    }

    if (originalLocalStorage === undefined) {
      Reflect.deleteProperty(scope, 'localStorage')
    } else {
      scope.localStorage = originalLocalStorage
    }
  }
})

interface FlagState {
  autosaveEnabled: boolean
  mergePrecision: MergePrecision
  mergeThreshold: number
}

function createPlan(state: FlagState): AutoSaveBootstrapPlan {
  return {
    snapshot: {
      ...DEFAULT_FLAG_SNAPSHOT,
      autosave: {
        ...DEFAULT_FLAG_SNAPSHOT.autosave,
        value: state.autosaveEnabled,
        enabled: state.autosaveEnabled,
        source: 'workspace',
        errors: []
      },
      merge: {
        ...DEFAULT_FLAG_SNAPSHOT.merge,
        value: state.mergePrecision,
        precision: state.mergePrecision,
        threshold: state.mergeThreshold,
        source: 'workspace',
        errors: []
      }
    },
    guard: {
      featureFlag: { value: state.autosaveEnabled, source: 'workspace' },
      optionsDisabled: false
    },
    failSafePhase: 'phase-a0',
    policy: AUTOSAVE_POLICY,
    errors: []
  }
}

class MockAutoSaveRunner implements AutoSaveInitResult {
  private readonly listeners = new Set<() => void>()
  private lastSuccessAt: string

  constructor(label: string) {
    this.lastSuccessAt = `${label}:initial`
  }

  snapshot(): { phase: 'idle'; lastSuccessAt: string; retryCount: number } {
    return { phase: 'idle', lastSuccessAt: this.lastSuccessAt, retryCount: 0 }
  }

  async flushNow(): Promise<void> {
    this.lastSuccessAt = `${this.lastSuccessAt}:flush`
    for (const listener of this.listeners) {
      listener()
    }
  }

  async dispose(): Promise<void> {}

  markDirty(): void {}

  onEvent(): () => void {
    const listener = () => {}
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

function createTestStore(): AutoSaveStoryboardStore {
  const storyboard: Storyboard = {
    id: 'sb-1',
    title: 'Test',
    scenes: [],
    selection: [],
    version: 1
  }
  const listeners = new Set<(state: { readonly sb: Storyboard }) => void>()
  return {
    getState() {
      return { sb: storyboard }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

interface UpdateRecord {
  readonly snapshot: FlagSnapshot
  readonly plan: AutoSaveBootstrapPlan
  readonly decision: AutoSaveActivationDecision | null
  readonly merge: MergeDockIntegrationSnapshot
}

interface IntegrationHarness {
  readonly updates: UpdateRecord[]
  readonly bridgeAttached: MockAutoSaveRunner[]
  readonly bridgeDetached: MockAutoSaveRunner[]
  readonly diffAttached: MockAutoSaveRunner[]
  readonly diffDetached: MockAutoSaveRunner[]
  dispose(): void
}

function createIntegrationHarness(options: {
  readonly resolveOptions: ResolveOptions
  readonly resolvePlan: () => AutoSaveBootstrapPlan
}): IntegrationHarness {
  const subscription = createFlagSnapshotSubscription(options.resolveOptions)
  const store = createTestStore()
  const runnerRef: { current: AutoSaveInitResult | null } = { current: null }
  const bridgeRef: { current: (() => void) | null } = { current: null }
  const subscriptionRef: { current: (() => void) | null } = { current: null }
  let cleanup: (() => void) | undefined
  const updates: UpdateRecord[] = []
  const bridgeAttached: MockAutoSaveRunner[] = []
  const bridgeDetached: MockAutoSaveRunner[] = []
  const diffAttached: MockAutoSaveRunner[] = []
  const diffDetached: MockAutoSaveRunner[] = []

  const applyPlan = (snapshot: FlagSnapshot) => {
    cleanup?.()
    const plan = options.resolvePlan()
    const mergeAlignedPlan =
      plan.snapshot.merge === snapshot.merge
        ? plan
        : {
            ...plan,
            snapshot: { ...plan.snapshot, merge: snapshot.merge }
          }
    const result = synchronizeAutoSaveIntegration({
      plan,
      context: {
        store,
        runnerRef,
        bridgeRef,
        subscriptionRef
      },
      initAutoSaveImpl: () => new MockAutoSaveRunner(snapshot.merge.precision ?? 'legacy'),
      installBridge(runner) {
        bridgeAttached.push(runner)
        return () => {
          bridgeDetached.push(runner)
        }
      },
      watchDiffs: (_store, _ref, runner) => {
        diffAttached.push(runner)
        return () => {
          diffDetached.push(runner)
        }
      }
    })
    cleanup = result.cleanup
    updates.push({
      snapshot,
      plan,
      decision: result.decision,
      merge: resolveMergeDockIntegration(mergeAlignedPlan, options.resolveOptions ?? null)
    })
  }

  let lastKey: string | null = null
  const handleSnapshot = (snapshot: FlagSnapshot) => {
    const key = JSON.stringify({
      autosave: { enabled: snapshot.autosave.enabled, source: snapshot.autosave.source },
      merge: {
        precision: snapshot.merge.precision,
        source: snapshot.merge.source,
        threshold: snapshot.merge.threshold
      }
    })
    if (key === lastKey) {
      return
    }
    lastKey = key
    applyPlan(snapshot)
  }

  handleSnapshot(subscription.read())
  const unsubscribe = subscription.subscribe(handleSnapshot)

  return {
    updates,
    bridgeAttached,
    bridgeDetached,
    diffAttached,
    diffDetached,
    dispose() {
      unsubscribe()
      cleanup?.()
      subscription.dispose()
    }
  }
}

test('App refreshes AutoSave bridge and MergeDock flags when snapshot clock is fixed', () => {
  const scope = globalThis as MutableGlobal
  const originalWindow = scope.window
  const originalDocument = scope.document
  const originalLocalStorage = scope.localStorage
  const originalNavigator = scope.navigator

  const events = new EventTarget()
  const storage = new MemoryStorage()
  const windowMock = {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    localStorage: storage
  } as unknown as Window
  const documentMock = {
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible'
  } as unknown as Document

  scope.window = windowMock
  scope.document = documentMock
  scope.localStorage = storage
  scope.navigator = { userAgent: 'node-test' }

  const state: FlagState = {
    autosaveEnabled: true,
    mergePrecision: 'legacy',
    mergeThreshold: DEFAULT_FLAG_SNAPSHOT.merge.threshold ?? 50
  }
  storage.setItem('autosave.enabled', 'true')
  storage.setItem('merge.precision', state.mergePrecision)

  const planCalls: Array<{ autosave: boolean; precision: MergePrecision }> = []
  const resolvePlan = () => {
    const plan = createPlan(state)
    planCalls.push({ autosave: state.autosaveEnabled, precision: state.mergePrecision })
    return plan
  }
  const resolveOptions: ResolveOptions = {
    clock: () => new Date('2025-02-14T09:00:00.000Z')
  }

  const harness = createIntegrationHarness({ resolveOptions, resolvePlan })

  try {
    assert.equal(planCalls.length, 1)
    assert.equal(harness.updates.at(-1)?.decision?.mode, 'autosave')
    assert.equal(harness.bridgeAttached.length, 1)
    assert.equal(harness.bridgeDetached.length, 0)

    state.autosaveEnabled = false
    storage.setItem('autosave.enabled', 'false')
    notifyFlagSnapshotRefresh()

    assert.equal(planCalls.length, 2)
    assert.equal(harness.updates.at(-1)?.decision?.mode, 'manual-only')
    assert.equal(harness.bridgeDetached.length, 1)

    state.autosaveEnabled = true
    state.mergePrecision = 'beta'
    storage.setItem('autosave.enabled', 'true')
    storage.setItem('merge.precision', 'beta')
    notifyFlagSnapshotRefresh()

    assert.equal(planCalls.length, 3)
    assert.equal(harness.updates.at(-1)?.decision?.mode, 'autosave')
    assert.equal(harness.updates.at(-1)?.merge.flagSnapshot.merge.precision, 'beta')
    assert.equal(harness.bridgeAttached.length, 2)
  } finally {
    harness.dispose()

    if (originalWindow === undefined) {
      Reflect.deleteProperty(scope, 'window')
    } else {
      scope.window = originalWindow
    }

    if (originalDocument === undefined) {
      Reflect.deleteProperty(scope, 'document')
    } else {
      scope.document = originalDocument
    }

    if (originalLocalStorage === undefined) {
      Reflect.deleteProperty(scope, 'localStorage')
    } else {
      scope.localStorage = originalLocalStorage
    }

    if (originalNavigator === undefined) {
      Reflect.deleteProperty(scope, 'navigator')
    } else {
      scope.navigator = originalNavigator
    }
  }
})
