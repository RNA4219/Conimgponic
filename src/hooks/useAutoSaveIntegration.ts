import { useEffect, useMemo, useRef, useState } from 'react'

import {
  resolveAutoSaveBootstrapPlan,
  type AutoSaveBootstrapPlan,
  type FlagSnapshot,
  type ResolveOptions,
} from '../config'
import {
  initAutoSave,
  type AutoSaveInitResult,
  type AutoSavePhaseGuardSnapshot,
} from '../lib/autosave'
import { getDay8Collector } from '../telemetry/day8Collector'
import type { Storyboard } from '../types'
import {
  createKeyboardShortcutHandler,
  createBrowserToolbarNotifiers,
  type KeyboardShortcutHandlerOptions,
  type ShortcutKeyEvent,
  type ToolbarNotifiers,
} from '../toolbar/handlers'

export type AutoSaveActivationDecision =
  | {
      readonly mode: 'manual-only'
      readonly guard: AutoSavePhaseGuardSnapshot
      readonly reason: 'phase-a0-failsafe' | 'feature-flag-disabled' | 'options-disabled'
    }
  | {
      readonly mode: 'autosave'
      readonly guard: AutoSavePhaseGuardSnapshot
      readonly reason: 'feature-flag-enabled'
    }

export interface AutoSaveStoryboardStore {
  readonly getState: () => { readonly sb: Storyboard }
  readonly subscribe: (
    listener: (state: { readonly sb: Storyboard }) => void
  ) => () => void
}

export interface AutoSaveRunnerRef {
  current: AutoSaveInitResult | null
}

export interface AutoSaveBridgeRef {
  current: (() => void) | null
}

export interface AutoSaveSubscriptionRef {
  current: (() => void) | null
}

export interface AutoSaveIntegrationContext {
  readonly store: AutoSaveStoryboardStore
  readonly runnerRef: AutoSaveRunnerRef
  readonly bridgeRef: AutoSaveBridgeRef
  readonly subscriptionRef: AutoSaveSubscriptionRef
}

export function planAutoSave(plan: AutoSaveBootstrapPlan): AutoSaveActivationDecision {
  if (plan.guard.optionsDisabled) {
    return { mode: 'manual-only', guard: plan.guard, reason: 'options-disabled' }
  }
  if (!plan.guard.featureFlag.value) {
    const reason =
      plan.failSafePhase === 'phase-a0' ? 'phase-a0-failsafe' : 'feature-flag-disabled'
    return { mode: 'manual-only', guard: plan.guard, reason }
  }
  return { mode: 'autosave', guard: plan.guard, reason: 'feature-flag-enabled' }
}

export function publishAutoSaveGuard(decision: AutoSaveActivationDecision): void {
  if (decision.mode !== 'manual-only') {
    return
  }
  const collector = getDay8Collector()
  if (!collector) {
    return
  }
  collector.publish({
    feature: 'autosave-diff-merge',
    event: 'autosave.guard',
    blocked: true,
    reason: decision.reason,
    guard: decision.guard,
    ts: new Date().toISOString()
  })
}

type MergeDockWindow = Window & {
  __mergeDockFlushNow?: () => void
  __mergeDockAutoSaveSnapshot?: { lastSuccessAt?: string }
}

const resolveMergeDockWindow = (target?: Window): MergeDockWindow | undefined => {
  if (target) {
    return target as MergeDockWindow
  }
  if (typeof window === 'undefined') {
    return undefined
  }
  return window as MergeDockWindow
}

const updateMergeDockSnapshot = (
  runner: AutoSaveInitResult,
  snapshotBox: { lastSuccessAt?: string }
): void => {
  const snapshot = runner.snapshot()
  snapshotBox.lastSuccessAt = snapshot.lastSuccessAt
}

export const installMergeDockAutoSaveBridge = (
  runner: AutoSaveInitResult,
  target?: Window
): (() => void) => {
  const mergeWindow = resolveMergeDockWindow(target)
  if (!mergeWindow) {
    return () => {}
  }

  const snapshotBox: { lastSuccessAt?: string } = {
    lastSuccessAt: runner.snapshot().lastSuccessAt,
  }

  const flushWrapper = (): void => {
    runner
      .flushNow()
      .then(() => {
        updateMergeDockSnapshot(runner, snapshotBox)
      })
      .catch((error) => {
        console.error('MergeDock: AutoSave flush failed', error)
      })
  }

  mergeWindow.__mergeDockAutoSaveSnapshot = snapshotBox
  mergeWindow.__mergeDockFlushNow = flushWrapper

  const unsubscribe = runner.onEvent(() => {
    updateMergeDockSnapshot(runner, snapshotBox)
  })

  return () => {
    unsubscribe()
    if (mergeWindow.__mergeDockFlushNow === flushWrapper) {
      delete mergeWindow.__mergeDockFlushNow
    }
    if (mergeWindow.__mergeDockAutoSaveSnapshot === snapshotBox) {
      delete mergeWindow.__mergeDockAutoSaveSnapshot
    }
  }
}

export function watchAutoSaveStoryboardDiffs(
  store: AutoSaveStoryboardStore,
  runnerRef: AutoSaveRunnerRef,
  runner: AutoSaveInitResult
): () => void {
  let previousSerialized = JSON.stringify(store.getState().sb)
  return store.subscribe((state) => {
    const serialized = JSON.stringify(state.sb)
    if (serialized === previousSerialized) {
      return
    }
    previousSerialized = serialized
    if (runnerRef.current !== runner) {
      return
    }
    const pendingBytes = serialized.length
    runnerRef.current?.markDirty({ pendingBytes })
  })
}

function disposeActiveIntegration(context: AutoSaveIntegrationContext): void {
  if (context.subscriptionRef.current) {
    const unsubscribe = context.subscriptionRef.current
    context.subscriptionRef.current = null
    unsubscribe()
  }
  if (context.bridgeRef.current) {
    const detach = context.bridgeRef.current
    context.bridgeRef.current = null
    detach()
  }
  const runner = context.runnerRef.current
  if (runner) {
    context.runnerRef.current = null
    void runner.dispose()
  }
}

export interface AutoSaveIntegrationSynchronizationOptions {
  readonly plan: AutoSaveBootstrapPlan | null
  readonly context: AutoSaveIntegrationContext
  readonly initAutoSaveImpl?: (
    provider: () => Storyboard,
    options: { readonly disabled?: boolean },
    snapshot: FlagSnapshot['autosave']
  ) => AutoSaveInitResult
  readonly installBridge?: (runner: AutoSaveInitResult) => () => void
  readonly watchDiffs?: (
    store: AutoSaveStoryboardStore,
    runnerRef: AutoSaveRunnerRef,
    runner: AutoSaveInitResult
  ) => () => void
}

export interface AutoSaveIntegrationSynchronizationResult {
  readonly decision: AutoSaveActivationDecision | null
  readonly cleanup?: () => void
}

export function synchronizeAutoSaveIntegration({
  plan,
  context,
  initAutoSaveImpl = initAutoSave,
  installBridge = installMergeDockAutoSaveBridge,
  watchDiffs = watchAutoSaveStoryboardDiffs,
}: AutoSaveIntegrationSynchronizationOptions): AutoSaveIntegrationSynchronizationResult {
  disposeActiveIntegration(context)

  if (!plan) {
    return { decision: null }
  }

  const decision = planAutoSave(plan)
  if (decision.mode !== 'autosave') {
    return { decision }
  }

  const runner = initAutoSaveImpl(
    () => context.store.getState().sb,
    { disabled: decision.guard.optionsDisabled },
    plan.snapshot.autosave
  )
  context.runnerRef.current = runner

  const detachBridge = installBridge(runner)
  context.bridgeRef.current = detachBridge

  const unsubscribe = watchDiffs(context.store, context.runnerRef, runner)
  context.subscriptionRef.current = unsubscribe

  return {
    decision,
    cleanup() {
      disposeActiveIntegration(context)
    },
  }
}

export interface AutoSaveIntegrationDependencies {
  readonly resolvePlan?: (options?: ResolveOptions | null) => AutoSaveBootstrapPlan
  readonly initAutoSaveImpl?: AutoSaveIntegrationSynchronizationOptions['initAutoSaveImpl']
  readonly installBridge?: (runner: AutoSaveInitResult) => () => void
  readonly watchDiffs?: AutoSaveIntegrationSynchronizationOptions['watchDiffs']
}

export interface UseAutoSaveIntegrationOptions {
  readonly resolveOptions?: ResolveOptions | null
  readonly store: AutoSaveStoryboardStore
  readonly deps?: AutoSaveIntegrationDependencies
}

export interface UseAutoSaveIntegrationResult {
  readonly autoSavePlan: AutoSaveBootstrapPlan | null
  readonly autoSaveDecision: AutoSaveActivationDecision | null
}

const defaultResolvePlan = (options?: ResolveOptions | null): AutoSaveBootstrapPlan =>
  resolveAutoSaveBootstrapPlan(options ?? undefined)

export function useAutoSaveIntegration({
  resolveOptions = null,
  store,
  deps,
}: UseAutoSaveIntegrationOptions): UseAutoSaveIntegrationResult {
  const [autoSavePlan, setAutoSavePlan] = useState<AutoSaveBootstrapPlan | null>(null)
  const [autoSaveDecision, setAutoSaveDecision] =
    useState<AutoSaveActivationDecision | null>(null)

  const runnerRef = useRef<AutoSaveInitResult | null>(null)
  const bridgeRef = useRef<(() => void) | null>(null)
  const subscriptionRef = useRef<(() => void) | null>(null)

  const { resolvePlan, initAutoSaveImpl, installBridge, watchDiffs } = useMemo(
    () => ({
      resolvePlan: deps?.resolvePlan ?? defaultResolvePlan,
      initAutoSaveImpl: deps?.initAutoSaveImpl ?? initAutoSave,
      installBridge: deps?.installBridge ?? installMergeDockAutoSaveBridge,
      watchDiffs: deps?.watchDiffs ?? watchAutoSaveStoryboardDiffs,
    }),
    [deps]
  )

  useEffect(() => {
    const plan = resolvePlan(resolveOptions ?? null)
    setAutoSavePlan(plan)
  }, [resolveOptions, resolvePlan])

  useEffect(() => {
    const { decision, cleanup } = synchronizeAutoSaveIntegration({
      plan: autoSavePlan,
      context: { store, runnerRef, bridgeRef, subscriptionRef },
      initAutoSaveImpl,
      installBridge,
      watchDiffs,
    })
    setAutoSaveDecision(decision)
    return cleanup
  }, [autoSavePlan, store, initAutoSaveImpl, installBridge, watchDiffs])

  return { autoSavePlan, autoSaveDecision }
}

export interface AutoSaveShortcutOptions {
  readonly notifiers?: ToolbarNotifiers
  readonly saveProject: (storyboard: Storyboard) => Promise<void>
  readonly saveSnapshot: (storyboard: Storyboard) => Promise<void>
  readonly addScene: () => void
  readonly register?: (handler: (event: KeyboardEvent) => void) => () => void
}

export interface AutoSaveAppEffectsOptions {
  readonly resolveOptions?: ResolveOptions | null
  readonly store: AutoSaveStoryboardStore
  readonly shortcut: AutoSaveShortcutOptions
  readonly deps?: AutoSaveIntegrationDependencies & {
    readonly publishGuard?: (decision: AutoSaveActivationDecision) => void
    readonly createShortcutHandler?: (
      options: KeyboardShortcutHandlerOptions
    ) => (event: ShortcutKeyEvent) => Promise<void> | void
  }
}

const defaultRegisterShortcut = (
  handler: (event: KeyboardEvent) => void
): (() => void) => {
  if (typeof window === 'undefined') {
    return () => {}
  }
  const wrapped = (event: KeyboardEvent): void => {
    handler(event)
  }
  window.addEventListener('keydown', wrapped)
  return () => {
    window.removeEventListener('keydown', wrapped)
  }
}

const resolveShortcutNotifiers = (notifiers?: ToolbarNotifiers): ToolbarNotifiers =>
  notifiers ?? createBrowserToolbarNotifiers()

export function registerAutoSaveShortcuts(
  shortcut: AutoSaveShortcutOptions,
  store: AutoSaveStoryboardStore,
  handlerFactory: (options: KeyboardShortcutHandlerOptions) => (event: ShortcutKeyEvent) => Promise<void> | void
): (() => void) | undefined {
  const register = shortcut.register ?? defaultRegisterShortcut
  const notifiers = resolveShortcutNotifiers(shortcut.notifiers)
  const handler = handlerFactory({
    getStoryboard: () => store.getState().sb,
    saveProject: shortcut.saveProject,
    saveSnapshot: shortcut.saveSnapshot,
    addScene: shortcut.addScene,
    alert: (message) => {
      notifiers.alert(message)
    },
    consoleError: (message, error) => {
      notifiers.consoleError(message, error)
    }
  })
  return register((event: KeyboardEvent) => {
    handler(event as ShortcutKeyEvent)
  })
}

export function useAutoSaveAppEffects({
  resolveOptions = null,
  store,
  shortcut,
  deps
}: AutoSaveAppEffectsOptions): UseAutoSaveIntegrationResult {
  const integrationDeps = useMemo(() => deps, [deps])
  const result = useAutoSaveIntegration({
    resolveOptions,
    store,
    deps: integrationDeps
  })

  const publishGuardImpl = useMemo(
    () => deps?.publishGuard ?? publishAutoSaveGuard,
    [deps?.publishGuard]
  )

  useEffect(() => {
    const decision = result.autoSaveDecision
    if (!decision) {
      return
    }
    publishGuardImpl(decision)
  }, [publishGuardImpl, result.autoSaveDecision])

  useEffect(() => {
    const handlerFactory = deps?.createShortcutHandler ?? createKeyboardShortcutHandler
    return registerAutoSaveShortcuts(shortcut, store, handlerFactory)
  }, [
    deps?.createShortcutHandler,
    shortcut.register,
    shortcut.notifiers,
    shortcut.saveProject,
    shortcut.saveSnapshot,
    shortcut.addScene,
    store
  ])

  useMemo(() => {
    const handlerFactory = deps?.createShortcutHandler ?? createKeyboardShortcutHandler
    registerAutoSaveShortcuts(shortcut, store, handlerFactory)
  }, [
    deps?.createShortcutHandler,
    shortcut.register,
    shortcut.notifiers,
    shortcut.saveProject,
    shortcut.saveSnapshot,
    shortcut.addScene,
    store
  ])

  return result
}
