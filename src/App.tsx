import React, {
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
import { saveJSON, loadJSON } from './lib/opfs'
import { TemplatesMenu } from './components/TemplatesMenu'
import { buildPackage } from './lib/package'
import { getDay8Collector } from './telemetry/day8Collector'
import {
  useAutoSaveIntegration,
  type AutoSaveActivationDecision
} from './hooks/useAutoSaveIntegration'
import * as toolbarHandlers from './toolbar/handlers'

export {
  handleToolbarSaveProject,
  handleToolbarLoadProject,
  handleToolbarPackageExport
} from './toolbar/handlers'
export type { ToolbarNotifiers } from './toolbar/handlers'

export {
  planAutoSave,
  installMergeDockAutoSaveBridge,
  watchAutoSaveStoryboardDiffs
} from './hooks/useAutoSaveIntegration'

export type { AutoSaveActivationDecision } from './hooks/useAutoSaveIntegration'

type ToolbarSaveProjectRequest = Parameters<
  typeof toolbarHandlers.handleToolbarSaveProject
>[0]

type ToolbarSave = ToolbarSaveProjectRequest['save']

type SaveProjectButtonHandlerOptions =
  | (toolbarHandlers.ToolbarNotifiers & {
      readonly storyboard: Storyboard
      readonly save?: ToolbarSave
    })
  | (toolbarHandlers.ToolbarNotifiers & {
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

  await toolbarHandlers.handleToolbarSaveProject({
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

export function resolveAutoSaveBootstrapPlanForApp(
  applyPlan: (plan: AutoSaveBootstrapPlan) => void
): AutoSaveBootstrapPlan {
  const plan = resolveAutoSaveBootstrapPlan()
  applyPlan(plan)
  return plan
}

export interface MergeDockIntegrationSnapshot {
  readonly flagSnapshot: Pick<FlagSnapshot, 'merge'>
  readonly mergeThreshold: number | null
  readonly workspace: ResolveOptions['workspace'] | null
}

const FLAG_REFRESH_EVENT = 'conimg:flags:refresh'

const FLAG_STORAGE_KEYS = new Set([
  'autosave.enabled',
  'merge.precision',
  'flag:autoSave.enabled',
  'flag:merge.precision'
])

type FlagSnapshotListener = (snapshot: FlagSnapshot) => void

export interface FlagSnapshotSubscription {
  readonly read: () => FlagSnapshot
  readonly subscribe: (listener: FlagSnapshotListener) => () => void
  readonly refresh: () => void
  readonly dispose: () => void
}

export function createFlagSnapshotSubscription(
  options?: ResolveOptions | null
): FlagSnapshotSubscription {
  const listeners = new Set<FlagSnapshotListener>()
  let disposed = false
  let current = resolveFlags(options ?? undefined)

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
    notify(resolveFlags(options ?? undefined))
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

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage)
    window.addEventListener(FLAG_REFRESH_EVENT, handleRefreshEvent)
  }

  if (typeof document !== 'undefined') {
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
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(FLAG_REFRESH_EVENT, handleRefreshEvent)
    }
    if (typeof document !== 'undefined') {
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

export function resolveMergeDockIntegration(
  plan: AutoSaveBootstrapPlan | null,
  options?: ResolveOptions | null
): MergeDockIntegrationSnapshot {
  const snapshot = plan?.snapshot ?? DEFAULT_FLAG_SNAPSHOT
  const threshold = plan?.snapshot.merge.threshold ?? snapshot.merge.threshold ?? null
  const flagSnapshot: Pick<FlagSnapshot, 'merge'> = { merge: snapshot.merge }
  return {
    flagSnapshot,
    mergeThreshold: threshold,
    workspace: options?.workspace ?? null
  }
}

export interface ShortcutKeyEvent {
  readonly key: string
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  preventDefault(): void
}

export interface KeyboardShortcutHandlerOptions {
  readonly getStoryboard: () => Storyboard
  readonly saveProject: (storyboard: Storyboard) => Promise<void>
  readonly saveSnapshot: (storyboard: Storyboard) => Promise<void>
  readonly addScene: () => void
  readonly alert: (message: string) => void
  readonly consoleError: (message: string, error: unknown) => void
}

export function createKeyboardShortcutHandler(
  options: KeyboardShortcutHandlerOptions
): (event: ShortcutKeyEvent) => Promise<void> | void {
  const {
    getStoryboard,
    saveProject,
    saveSnapshot,
    addScene,
    alert: alertUser,
    consoleError
  } = options

  function notifyFailure(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error)
    alertUser(`保存に失敗しました: ${detail}`)
    consoleError('Keyboard shortcut handler failed', error)
  }

  return (event) => {
    try {
      if (!event.ctrlKey) {
        return
      }

      const key = event.key.toLowerCase()
      if (key === 's' && !event.shiftKey) {
        event.preventDefault()
        const storyboard = getStoryboard()
        return saveProject(storyboard).catch((error) => {
          notifyFailure(error)
        })
      }

      if (key === 's' && event.shiftKey) {
        event.preventDefault()
        const storyboard = getStoryboard()
        return saveSnapshot(storyboard).catch((error) => {
          notifyFailure(error)
        })
      }

      if (key === 'n' && event.altKey) {
        event.preventDefault()
        addScene()
      }
    } catch (error) {
      notifyFailure(error)
    }
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
  const flagSubscription = useMemo(
    () => createFlagSnapshotSubscription(resolveOptions ?? null),
    [resolveOptions]
  )
  const flagSnapshot = useSyncExternalStore(
    flagSubscription.subscribe,
    flagSubscription.read,
    flagSubscription.read
  )
  useEffect(() => {
    flagSubscription.refresh()
    return () => {
      flagSubscription.dispose()
    }
  }, [flagSubscription])
  const autoSaveDeps = useMemo(
    () => ({
      resolvePlan: () => resolveAutoSaveBootstrapPlan(resolveOptions ?? undefined)
    }),
    [resolveOptions, flagSnapshot.updatedAt]
  )
  const { autoSavePlan, autoSaveDecision } = useAutoSaveIntegration({
    resolveOptions: resolveOptions ?? null,
    store: useSB,
    deps: autoSaveDeps
  })
  const mergeDockIntegration = useMemo(() => {
    if (!autoSavePlan) {
      return resolveMergeDockIntegration(null, resolveOptions ?? null)
    }
    const mergeAlignedPlan: AutoSaveBootstrapPlan =
      autoSavePlan.snapshot.merge === flagSnapshot.merge
        ? autoSavePlan
        : {
            ...autoSavePlan,
            snapshot: { ...autoSavePlan.snapshot, merge: flagSnapshot.merge }
          }
    return resolveMergeDockIntegration(mergeAlignedPlan, resolveOptions ?? null)
  }, [autoSavePlan, flagSnapshot.merge, resolveOptions])
  const mergeDockFlags = mergeDockIntegration.flagSnapshot
  const toolbarNotifiers: toolbarHandlers.ToolbarNotifiers = {
    alert(message) {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(message)
      }
    },
    consoleError(message, error) {
      console.error(message, error)
    }
  }

  useEffect(()=>{
    const handler = createKeyboardShortcutHandler({
      getStoryboard: () => useSB.getState().sb,
      async saveProject(storyboard) {
        await saveJSON('project/storyboard.json', storyboard)
      },
      async saveSnapshot(storyboard) {
        const { ensureDir, saveText } = await import('./lib/opfs')
        const { toMarkdown, toCSV, toJSONL } = await import('./lib/exporters')
        const { sha256Hex } = await import('./lib/hash')
        const ts = new Date().toISOString().replace(/[:.]/g,'-')
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
      },
      addScene() {
        useSB.getState().addScene()
      },
      alert(message) {
        window.alert(message)
      },
      consoleError(message, error) {
        console.error(message, error)
      }
    })

    function onKey(event: KeyboardEvent): void {
      handler(event)
    }

    window.addEventListener('keydown', onKey)
    return ()=> window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(()=>{
    if (!autoSaveDecision){
      return
    }
    publishAutoSaveGuard(autoSaveDecision)
  }, [autoSaveDecision])

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
            void handleSaveProjectButtonClick({
              storyboard: useSB.getState().sb,
              ...toolbarNotifiers
            })
          }}
        >
          Save Project
        </button>
        <button
          className="btn"
          onClick={() => {
            void toolbarHandlers.handleToolbarLoadProject({
              load: (path: string) => loadJSON<Storyboard>(path),
              applyStoryboard(storyboard: Storyboard) {
                useSB.setState({ sb: storyboard })
              },
              ...toolbarNotifiers
            })
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
            void toolbarHandlers.handleToolbarPackageExport({
              storyboard: useSB.getState().sb,
              build: buildPackage,
              createDownload(content: string, currentStoryboard: Storyboard) {
                const blob = new Blob([content], { type: 'application/json' })
                const anchor = document.createElement('a')
                anchor.href = URL.createObjectURL(blob)
                anchor.download = `${currentStoryboard.title || 'project'}.imgponic.json`
                anchor.click()
                setTimeout(() => {
                  URL.revokeObjectURL(anchor.href)
                }, 2000)
              },
              ...toolbarNotifiers
            })
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
      <div className="dock" style={{display: dockOpen?'block':'none'}}>
        <MergeDock
          flags={mergeDockFlags}
          mergeThreshold={mergeDockIntegration.mergeThreshold}
          workspace={mergeDockIntegration.workspace}
        />
      </div>
      {help && <HelpModal onClose={()=>setHelp(false)} />}
    </div>
  )
}
