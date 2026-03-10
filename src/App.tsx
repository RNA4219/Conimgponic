import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import { useSB } from './store'
import type { Storyboard } from './types'
import { LeftRight } from './components/LeftRightPanes'
import { StoryboardList } from './components/StoryboardList'
import { MergeDock } from './components/MergeDock'
import type { MergeDockPhaseStats } from './components/merge-dock/domain'
import {
  DEFAULT_FLAG_SNAPSHOT,
  OLLAMA_BASE,
  setOllamaBase,
  resolveAutoSaveBootstrapPlan,
  resolveFlags,
  type AutoSaveBootstrapPlan,
  type FlagSnapshot,
  type ResolveOptions
} from './config'
import type { FlagRolloutPhase } from './config/flags'
import { saveJSON } from './lib/opfs'
import { readWorkspaceSetting } from './lib/merge/threshold'
import { TemplatesMenu } from './components/TemplatesMenu'
import { useAutoSaveAppEffects } from './hooks/useAutoSaveIntegration'
import { readImportMetaEnv } from './lib/autosave/telemetryBridge'
import {
  handleToolbarSaveProject,
  createToolbarActions,
  createBrowserToolbarNotifiers,
  type ToolbarNotifiers
} from './toolbar/handlers'

export {
  handleToolbarSaveProject,
  handleToolbarLoadProject,
  handleToolbarPackageExport,
  createKeyboardShortcutHandler
} from './toolbar/handlers'
export type {
  ToolbarNotifiers,
  ShortcutKeyEvent,
  KeyboardShortcutHandlerOptions
} from './toolbar/handlers'

export {
  planAutoSave,
  installMergeDockAutoSaveBridge,
  watchAutoSaveStoryboardDiffs
} from './hooks/useAutoSaveIntegration'

export { publishAutoSaveGuard } from './hooks/useAutoSaveIntegration'

export type { AutoSaveActivationDecision } from './hooks/useAutoSaveIntegration'

type ToolbarSaveProjectRequest = Parameters<typeof handleToolbarSaveProject>[0]

type ToolbarSave = ToolbarSaveProjectRequest['save']

type SaveProjectButtonHandlerOptions =
  | (ToolbarNotifiers & {
      readonly storyboard: Storyboard
      readonly save?: ToolbarSave
    })
  | (ToolbarNotifiers & {
      readonly getStoryboard: () => Storyboard
      readonly saveJSONImpl?: ToolbarSave
    })

export async function handleSaveProjectButtonClick(
  options: SaveProjectButtonHandlerOptions
): Promise<void> {
  const { alert, consoleError } = options
  const storyboard =
    'storyboard' in options ? options.storyboard : options.getStoryboard()
  const save: ToolbarSave = (() => {
    if ('save' in options && options.save) {
      return options.save
    }
    if ('saveJSONImpl' in options && options.saveJSONImpl) {
      return options.saveJSONImpl
    }
    return saveJSON
  })()

  await handleToolbarSaveProject({
    storyboard,
    save,
    alert,
    consoleError
  })
}

function getDockOpenPreference(): boolean {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return true
  }

  try {
    return window.localStorage.getItem('dockOpen') !== '0'
  } catch {
    return true
  }
}

function setDockOpenPreference(value: boolean): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return
  }

  window.localStorage.setItem('dockOpen', value ? '1' : '0')
}

export function HelpModal({ onClose }: { onClose: () => void }): React.ReactElement {
  if (!isReactRendering()) {
    return renderHelpModalFallback(onClose)
  }

  return <HelpModalDialog onClose={onClose} />
}

function HelpModalDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  const handleDialogKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>
  ): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation?.()
      onClose()
    }
  }

  const handleDialogClick = useMemo(() => {
    return (event: React.MouseEvent<HTMLDivElement>): void => {
      event.stopPropagation?.()
    }
  }, [])

  return (
    <div
      role="presentation"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', zIndex: 50 }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="card"
        style={{ width: 600, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto', padding: 12, position: 'relative' }}
        onClick={handleDialogClick}
        onKeyDown={handleDialogKeyDown}
      >
        <button
          type="button"
          aria-label="ヘルプを閉じる"
          onClick={onClose}
          style={{ position: 'absolute', top: 8, right: 8 }}
        >
          ×
        </button>
        <h3>ショートカット</h3>
        <ul>
          <li><strong>Ctrl+Enter</strong>: 生成</li>
          <li><strong>Ctrl+S</strong>: プロジェクト保存</li>
          <li><strong>Ctrl+Shift+S</strong>: スナップショット保存</li>
          <li><strong>Ctrl+Alt+N</strong>: カード追加</li>
        </ul>
      </div>
    </div>
  )
}

function renderHelpModalFallback(onClose: () => void): React.ReactElement {
  const handleDialogKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>
  ): void => {
    if (event.key === 'Escape') {
      event.preventDefault?.()
      event.stopPropagation?.()
      onClose()
    }
  }

  const handleDialogClick = (
    event: React.MouseEvent<HTMLDivElement>
  ): void => {
    event.stopPropagation?.()
  }

  return (
    <div
      role="presentation"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', zIndex: 50 }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="card"
        style={{ width: 600, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto', padding: 12, position: 'relative' }}
        onClick={handleDialogClick}
        onKeyDown={handleDialogKeyDown}
      >
        <button
          type="button"
          aria-label="ヘルプを閉じる"
          onClick={onClose}
          style={{ position: 'absolute', top: 8, right: 8 }}
        >
          ×
        </button>
        <h3>ショートカット</h3>
        <ul>
          <li><strong>Ctrl+Enter</strong>: 生成</li>
          <li><strong>Ctrl+S</strong>: プロジェクト保存</li>
          <li><strong>Ctrl+Shift+S</strong>: スナップショット保存</li>
          <li><strong>Ctrl+Alt+N</strong>: カード追加</li>
        </ul>
      </div>
    </div>
  )
}

function isReactRendering(): boolean {
  const internals = (React as unknown as {
    readonly __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: {
      readonly ReactCurrentDispatcher?: { current: unknown }
    }
  }).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED

  return internals?.ReactCurrentDispatcher?.current != null
}

export function resolveAutoSaveBootstrapPlanForApp(
  applyPlan: (plan: AutoSaveBootstrapPlan) => void
): AutoSaveBootstrapPlan {
  const plan = resolveAutoSaveBootstrapPlan()
  applyPlan(plan)
  return plan
}

export interface MergeDockIntegrationSnapshot {
  readonly flagSnapshot: Pick<FlagSnapshot, 'merge' | 'autosave'>
  readonly mergeThreshold: number | null
  readonly autoAppliedRate: number | null
  readonly workspace: ResolveOptions['workspace'] | null
  readonly phaseStats: MergeDockPhaseStats | null
}

const MERGE_PHASE_REVIEW_KEY = 'merge.phaseStats.reviewBandCount'
const MERGE_PHASE_CONFLICT_KEY = 'merge.phaseStats.conflictBandCount'

const parsePhaseBandCount = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value))
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed))
    }
  }
  return null
}

const resolveWorkspacePhaseStats = (
  workspace: ResolveOptions['workspace'] | null | undefined,
): MergeDockPhaseStats | null => {
  if (!workspace) {
    return null
  }

  const review = parsePhaseBandCount(readWorkspaceSetting(workspace, MERGE_PHASE_REVIEW_KEY))
  const conflict = parsePhaseBandCount(readWorkspaceSetting(workspace, MERGE_PHASE_CONFLICT_KEY))

  if (review === null && conflict === null) {
    return null
  }

  return {
    reviewBandCount: review ?? 0,
    conflictBandCount: conflict ?? 0,
  }
}

const FLAG_REFRESH_EVENT = 'conimg:flags:refresh'

const FLAG_STORAGE_KEYS = new Set([
  'autosave.enabled',
  'merge.precision',
  'flag:autoSave.enabled',
  'flag:merge.precision',
  'plugins.enable',
  'flag:plugins.enable'
])

type FlagSnapshotListener = (snapshot: FlagSnapshot) => void

export interface FlagSnapshotSubscriptionConfig {
  readonly liveRefreshPhase?: FlagRolloutPhase | null
  readonly enableLiveRefresh?: boolean
}

type FlagLiveRefreshScope = typeof globalThis & {
  __FLAG_SNAPSHOT_LIVE_REFRESH_PHASE__?: unknown
  process?: { env?: Record<string, unknown> }
}

const LIVE_REFRESH_ENABLED_PHASES: ReadonlySet<FlagRolloutPhase> = new Set([
  'phase-b0',
  'phase-b1'
])

const parseLiveRefreshPhase = (
  value: unknown
): FlagRolloutPhase | null => {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim().toLowerCase()
  switch (normalized) {
    case 'phase-b0':
    case 'phase-b1':
      return normalized
    default:
      return null
  }
}

const readLiveRefreshPhaseFromEnvironment = (): FlagRolloutPhase | null => {
  const scope = globalThis as FlagLiveRefreshScope
  const importMetaEnv = readImportMetaEnv()
  const candidates: readonly unknown[] = [
    scope.__FLAG_SNAPSHOT_LIVE_REFRESH_PHASE__,
    importMetaEnv?.VITE_FLAG_SNAPSHOT_LIVE_REFRESH_PHASE,
    scope.process?.env?.VITE_FLAG_SNAPSHOT_LIVE_REFRESH_PHASE
  ]
  for (const candidate of candidates) {
    const phase = parseLiveRefreshPhase(candidate)
    if (phase) {
      return phase
    }
  }
  return null
}

const shouldEnableLiveRefresh = (
  config: FlagSnapshotSubscriptionConfig | null | undefined
): boolean => {
  if (typeof config?.enableLiveRefresh === 'boolean') {
    return config.enableLiveRefresh
  }
  const phase =
    config?.liveRefreshPhase ?? readLiveRefreshPhaseFromEnvironment()
  return phase !== null && LIVE_REFRESH_ENABLED_PHASES.has(phase)
}

export interface FlagSnapshotSubscription {
  readonly read: () => FlagSnapshot
  readonly subscribe: (listener: FlagSnapshotListener) => () => void
  readonly refresh: () => void
  readonly dispose: () => void
}

export function createFlagSnapshotSubscription(
  options?: ResolveOptions | null,
  config?: FlagSnapshotSubscriptionConfig | null
): FlagSnapshotSubscription {
  const listeners = new Set<FlagSnapshotListener>()
  let disposed = false
  let current = resolveFlags(options ?? undefined) as FlagSnapshot

  const notify = (snapshot: FlagSnapshot): void => {
    current = snapshot
    for (const listener of listeners) {
      listener(snapshot)
    }
  }

  const refresh = (): void => {
    if (disposed) {
      return
    }
    notify(resolveFlags(options ?? undefined) as FlagSnapshot)
  }

  const handleStorage = (event: StorageEvent): void => {
    if (disposed) {
      return
    }
    if (event.key === null || FLAG_STORAGE_KEYS.has(event.key)) {
      refresh()
    }
  }

  const handleRefreshEvent: EventListener = () => {
    if (!disposed) {
      refresh()
    }
  }

  const handleVisibilityChange = (): void => {
    if (!disposed) {
      refresh()
    }
  }

  const liveRefreshEnabled = shouldEnableLiveRefresh(config)

  if (typeof window !== 'undefined') {
    if (liveRefreshEnabled) {
      window.addEventListener('storage', handleStorage)
    }
    window.addEventListener(FLAG_REFRESH_EVENT, handleRefreshEvent)
  }

  if (liveRefreshEnabled && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }

  const read = (): FlagSnapshot => current

  const subscribe = (listener: FlagSnapshotListener): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const dispose = (): void => {
    if (disposed) {
      return
    }
    disposed = true
    listeners.clear()
    if (typeof window !== 'undefined') {
      if (liveRefreshEnabled) {
        window.removeEventListener('storage', handleStorage)
      }
      window.removeEventListener(FLAG_REFRESH_EVENT, handleRefreshEvent)
    }
    if (liveRefreshEnabled && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }

  return { read, subscribe, refresh, dispose }
}

export function notifyFlagSnapshotRefresh(): void {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(new Event(FLAG_REFRESH_EVENT))
}

export function useFlagSnapshot(
  resolveOptions?: ResolveOptions | null
): FlagSnapshot {
  const subscription = useMemo(
    () => createFlagSnapshotSubscription(resolveOptions ?? null),
    [resolveOptions]
  )
  const snapshot = useSyncExternalStore(
    subscription.subscribe,
    subscription.read,
    subscription.read
  )
  useEffect(() => {
    subscription.refresh()
    return () => {
      subscription.dispose()
    }
  }, [subscription])
  return snapshot
}

const MERGE_COLLECTOR_STORAGE_KEYS = [
  'workflow-cookbook:collector:merge_auto_success_rate',
  'workflow-cookbook:collector:merge.autoAppliedRate',
  'merge.autoAppliedRate',
] as const

const expandWorkspaceKeys = (key: string): readonly string[] => {
  if (key.startsWith('conimg.')) {
    const trimmed = key.slice('conimg.'.length)
    return trimmed ? [key, trimmed] : [key]
  }
  return key ? [key, `conimg.${key}`] : [key]
}

const WORKSPACE_AUTO_APPLIED_KEYS = [
  'merge.autoAppliedRate',
  'merge.auto_success_rate',
  'metrics.merge.autoAppliedRate',
  'metrics.merge_auto_success_rate',
] as const

const coerceAutoAppliedRate = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }
    const parsed = Number.parseFloat(trimmed)
    if (Number.isFinite(parsed)) {
      return parsed
    }
    try {
      const json = JSON.parse(trimmed) as unknown
      return coerceAutoAppliedRate(json)
    } catch {
      return null
    }
  }
  if (Array.isArray(value) && value.length > 0) {
    return coerceAutoAppliedRate(value[0])
  }
  if (value && typeof value === 'object') {
    const record = value as { [key: string]: unknown }
    return (
      coerceAutoAppliedRate(record.autoAppliedRate) ??
      coerceAutoAppliedRate(record.merge_auto_success_rate) ??
      coerceAutoAppliedRate(record.value) ??
      null
    )
  }
  return null
}

const readWorkspaceAutoAppliedRate = (
  workspace: ResolveOptions['workspace'] | null | undefined,
): number | null => {
  if (!workspace) {
    return null
  }
  const withGetter = workspace as { get?: <T = unknown>(key: string) => T | undefined }
  for (const key of WORKSPACE_AUTO_APPLIED_KEYS) {
    const candidates = expandWorkspaceKeys(key)
    if (typeof withGetter.get === 'function') {
      for (const candidate of candidates) {
        try {
          const value = withGetter.get(candidate)
          const rate = coerceAutoAppliedRate(value)
          if (rate !== null) {
            return rate
          }
        } catch (error) {
          if (!candidate.startsWith('conimg.')) {
            throw error
          }
        }
      }
    }

    const record = workspace as Record<string, unknown>
    for (const candidate of candidates) {
      if (Object.prototype.hasOwnProperty.call(record, candidate)) {
        const rate = coerceAutoAppliedRate(record[candidate])
        if (rate !== null) {
          return rate
        }
      }
    }

    for (const candidate of candidates) {
      const segments = candidate.split('.')
      let current: unknown = workspace
      for (const segment of segments) {
        if (!current || typeof current !== 'object') {
          current = undefined
          break
        }
        current = (current as Record<string, unknown>)[segment]
      }
      const rate = coerceAutoAppliedRate(current)
      if (rate !== null) {
        return rate
      }
    }
  }
  return null
}

const readStorageAutoAppliedRate = (): number | null => {
  const scope = globalThis as { localStorage?: Storage }
  const storage = scope.localStorage
  if (!storage || typeof storage.getItem !== 'function') {
    return null
  }
  for (const key of MERGE_COLLECTOR_STORAGE_KEYS) {
    try {
      const raw = storage.getItem(key)
      const rate = coerceAutoAppliedRate(raw)
      if (rate !== null) {
        return rate
      }
    } catch {
      continue
    }
  }
  return null
}

const resolveCollectorAutoAppliedRate = (
  plan: AutoSaveBootstrapPlan | null,
  options?: ResolveOptions | null,
): number | null => {
  const mergeSnapshot = plan?.snapshot.merge as
    | (FlagSnapshot['merge'] & {
        autoAppliedRate?: unknown
        metrics?: { autoAppliedRate?: unknown; merge_auto_success_rate?: unknown }
      })
    | undefined
  const planRate =
    coerceAutoAppliedRate(mergeSnapshot?.autoAppliedRate) ??
    coerceAutoAppliedRate(mergeSnapshot?.metrics?.autoAppliedRate) ??
    coerceAutoAppliedRate(mergeSnapshot?.metrics?.merge_auto_success_rate)
  if (planRate !== null) {
    return planRate
  }
  const guardMetrics = (plan?.guard as { metrics?: { autoAppliedRate?: unknown; merge_auto_success_rate?: unknown } } | null | undefined)?.metrics
  const guardRate =
    coerceAutoAppliedRate(guardMetrics?.autoAppliedRate) ??
    coerceAutoAppliedRate(guardMetrics?.merge_auto_success_rate)
  if (guardRate !== null) {
    return guardRate
  }
  const workspaceRate = readWorkspaceAutoAppliedRate(options?.workspace)
  if (workspaceRate !== null) {
    return workspaceRate
  }
  return readStorageAutoAppliedRate()
}

export function resolveMergeDockIntegration(
  plan: AutoSaveBootstrapPlan | null,
  options?: ResolveOptions | null
): MergeDockIntegrationSnapshot {
  const snapshot = plan?.snapshot ?? DEFAULT_FLAG_SNAPSHOT
  const threshold = plan?.snapshot.merge.threshold ?? snapshot.merge.threshold ?? null
  const flagSnapshot: Pick<FlagSnapshot, 'merge' | 'autosave'> = {
    merge: snapshot.merge,
    autosave: snapshot.autosave
  }
  const workspace = options?.workspace ?? null
  const phaseStats = resolveWorkspacePhaseStats(workspace)
  return {
    flagSnapshot,
    mergeThreshold: threshold,
    autoAppliedRate: resolveCollectorAutoAppliedRate(plan, options),
    workspace,
    phaseStats
  }
}

export interface AppProps {
  readonly resolveOptions?: ResolveOptions | null
}

export default function App({ resolveOptions }: AppProps = {}){
  const { sb, setSBTitle, addScene } = useSB()
  const [dockOpen, setDockOpen] = useState(()=> getDockOpenPreference())
  const [help, setHelp] = useState(false)
  const [base, setBase] = useState(OLLAMA_BASE)
  const resolvedOptions = resolveOptions ?? null
  const flagSnapshot = useFlagSnapshot(resolvedOptions)
  const resolvePlan = useCallback(() => {
    return resolveAutoSaveBootstrapPlan(resolvedOptions ?? undefined)
  }, [
    resolvedOptions,
    flagSnapshot.autosave.value,
    flagSnapshot.autosave.source,
    flagSnapshot.merge.value,
    flagSnapshot.merge.source,
    flagSnapshot.merge.threshold
  ])
  const integrationDeps = useMemo(
    () => ({ resolvePlan }),
    [resolvePlan]
  )
  const saveProjectForShortcut = useCallback(async (storyboard: Storyboard) => {
    await saveJSON('project/storyboard.json', storyboard)
  }, [])

  const saveSnapshotForShortcut = useCallback(async (storyboard: Storyboard) => {
    const { ensureDir, saveText } = await import('./lib/opfs')
    const { toMarkdown, toCSV, toJSONL } = await import('./lib/exporters')
    const { sha256Hex } = await import('./lib/hash')
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const dir = `runs/${ts}`
    await ensureDir(dir)
    const md = toMarkdown(storyboard)
    const csv = toCSV(storyboard)
    const jsonl = toJSONL(storyboard)
    const hash = await sha256Hex(`${md}\n${csv}\n${jsonl}`)
    await saveText(`${dir}/shotlist.md`, md)
    await saveText(`${dir}/shotlist.csv`, csv)
    await saveText(`${dir}/shotlist.jsonl`, jsonl)
    await saveText(
      `${dir}/meta.json`,
      JSON.stringify({ hash, title: storyboard.title }, null, 2)
    )
    await saveText('runs/latest.txt', ts)
  }, [])

  const toolbarNotifiers = useMemo(() => createBrowserToolbarNotifiers(), [])
  const toolbarStore = useMemo(
    () => ({
      getStoryboard: () => useSB.getState().sb,
      applyStoryboard(storyboard: Storyboard) {
        useSB.setState({ sb: storyboard })
      }
    }),
    []
  )
  const toolbarActions = useMemo(
    () =>
      createToolbarActions({
        store: toolbarStore,
        notifiers: toolbarNotifiers
      }),
    [toolbarStore, toolbarNotifiers]
  )
  const isBrowser = typeof window !== 'undefined'

  const { autoSavePlan } = useAutoSaveAppEffects({
    resolveOptions: resolvedOptions,
    store: useSB,
    shortcut: {
      notifiers: toolbarNotifiers,
      saveProject: saveProjectForShortcut,
      saveSnapshot: saveSnapshotForShortcut,
      addScene
    },
    deps: integrationDeps
  })
  const mergeDockIntegration = useMemo(() => {
    if (!autoSavePlan) {
      return resolveMergeDockIntegration(null, resolvedOptions)
    }
    const mergeAlignedPlan: AutoSaveBootstrapPlan =
      autoSavePlan.snapshot.merge === flagSnapshot.merge
        ? autoSavePlan
        : {
            ...autoSavePlan,
            snapshot: { ...autoSavePlan.snapshot, merge: flagSnapshot.merge }
          }
    return resolveMergeDockIntegration(mergeAlignedPlan, resolvedOptions)
  }, [autoSavePlan, flagSnapshot.merge, resolvedOptions])
  const mergeDockFlags = mergeDockIntegration.flagSnapshot
  const mergeDockAutoSaveEnabled = mergeDockFlags.autosave.value === true
  return (
    <div className="app">
      <div className="toolbar">
        <strong>Imgponic</strong>
        <input value={sb.title} onChange={e=>setSBTitle(e.target.value)} style={{flex:1, padding:'.35rem .5rem', border:'1px solid #e5e5e5', borderRadius:8}}/>
        <TemplatesMenu onInsert={(t)=>{
          const ta = document.querySelector('.split .pane textarea') as HTMLTextAreaElement | null
          if (ta){ ta.value = (ta.value ? ta.value + '\n' : '') + t.text; ta.dispatchEvent(new Event('input', {bubbles:true})) }
        }} />
        <input value={base} onChange={e=>setBase(e.target.value)} placeholder="Ollama Base" style={{width:240, padding:'.35rem .5rem', border:'1px solid #e5e5e5', borderRadius:8}} />
        <button className="btn" onClick={()=>{ setOllamaBase(base); location.reload() }}>Save</button>
        <button
          className="btn"
          onClick={() => {
            void toolbarActions.saveProject()
          }}
        >
          Save Project
        </button>
        <button
          className="btn"
          onClick={() => {
            void toolbarActions.loadProject()
          }}
        >
          Load Project
        </button>
        <button className="btn" onClick={()=>addScene()}>+ カード</button>
        <button
          className="btn"
          onClick={() =>
            setDockOpen((v) => {
              const next = !v

              try {
                setDockOpenPreference(next)
              } catch (error) {
                console.warn('Failed to persist dock state preference', error)
              }

              return next
            })
          }
        >
          {dockOpen ? '統合 ⌃' : '統合 ⌄'}
        </button>
        <button
          className="btn"
          onClick={() => {
            void toolbarActions.exportPackage()
          }}
        >
          Package Export
        </button>
        <button className="btn" onClick={()=> setHelp(true)}>Help</button>
      </div>
      <div style={{display:'grid', gridTemplateRows:'minmax(220px, 45vh) 1fr'}}>
        <LeftRight />
        <StoryboardList />
      </div>
      {isBrowser ? (
        <div className="dock" style={{display: dockOpen?'block':'none'}}>
          <MergeDock
            flags={mergeDockFlags}
            mergeThreshold={mergeDockIntegration.mergeThreshold}
            autoAppliedRate={mergeDockIntegration.autoAppliedRate}
            phaseStats={mergeDockIntegration.phaseStats}
            workspace={mergeDockIntegration.workspace}
            autoSaveEnabled={mergeDockAutoSaveEnabled}
          />
        </div>
      ) : null}
      {help && <HelpModal onClose={()=>setHelp(false)} />}
    </div>
  )
}
