import React, { useEffect, useRef, useState } from 'react'
import { useSB } from './store'
import type { Storyboard } from './types'
import { LeftRight } from './components/LeftRightPanes'
import { StoryboardList } from './components/StoryboardList'
import { MergeDock } from './components/MergeDock'
import {
  OLLAMA_BASE,
  setOllamaBase,
  resolveAutoSaveBootstrapPlan,
  type AutoSaveBootstrapPlan
} from './config'
import { saveJSON, loadJSON } from './lib/opfs'
import { TemplatesMenu } from './components/TemplatesMenu'
import { buildPackage } from './lib/package'
import {
  initAutoSave,
  type AutoSaveInitResult,
  type AutoSavePhaseGuardSnapshot
} from './lib/autosave'
import { getDay8Collector } from './telemetry/day8Collector'

interface ToolbarNotifiers {
  readonly alert: (message: string) => void
  readonly consoleError: (message: string, error: unknown) => void
}

function formatOpfsError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return String(error)
}

function notifyOpfsFailure(
  notifiers: ToolbarNotifiers,
  alertPrefix: string,
  consoleMessage: string,
  error: unknown
): void {
  notifiers.alert(`${alertPrefix}: ${formatOpfsError(error)}`)
  notifiers.consoleError(consoleMessage, error)
}

export async function handleToolbarSaveProject(
  {
    storyboard,
    save,
    alert: alertUser,
    consoleError
  }: ToolbarNotifiers & {
    readonly storyboard: Storyboard
    readonly save: (path: string, storyboard: Storyboard) => Promise<void>
  }
): Promise<void> {
  try {
    await save('project/storyboard.json', storyboard)
    alertUser('Saved to OPFS: project/storyboard.json')
  } catch (error) {
    notifyOpfsFailure({ alert: alertUser, consoleError }, 'OPFS 保存に失敗しました', 'Failed to save project to OPFS', error)
  }
}

function isStoryboardPayload(candidate: unknown): candidate is Storyboard {
  if (!candidate || typeof candidate !== 'object') {
    return false
  }
  const storyboard = candidate as Storyboard
  return (
    typeof storyboard.id === 'string' &&
    typeof storyboard.title === 'string' &&
    Array.isArray(storyboard.scenes) &&
    Array.isArray(storyboard.selection)
  )
}

export async function handleToolbarLoadProject(
  {
    load,
    applyStoryboard,
    alert: alertUser,
    consoleError
  }: ToolbarNotifiers & {
    readonly load: (path: string) => Promise<Storyboard | null | undefined>
    readonly applyStoryboard: (storyboard: Storyboard) => void
  }
): Promise<void> {
  try {
    const storyboard = await load('project/storyboard.json')
    if (isStoryboardPayload(storyboard)) {
      applyStoryboard(storyboard)
      alertUser('Loaded from OPFS')
      return
    }
    alertUser('No project found')
  } catch (error) {
    notifyOpfsFailure(
      { alert: alertUser, consoleError },
      'OPFS 読み込みに失敗しました',
      'Failed to load project from OPFS',
      error
    )
  }
}

export async function handleToolbarPackageExport(
  {
    storyboard,
    build,
    createDownload,
    alert: alertUser,
    consoleError
  }: ToolbarNotifiers & {
    readonly storyboard: Storyboard
    readonly build: (storyboard: Storyboard) => Promise<string>
    readonly createDownload: (content: string, storyboard: Storyboard) => void
  }
): Promise<void> {
  try {
    const pkg = await build(storyboard)
    createDownload(pkg, storyboard)
  } catch (error) {
    notifyOpfsFailure(
      { alert: alertUser, consoleError },
      'パッケージ出力に失敗しました',
      'Failed to export package',
      error
    )
  }
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

function HelpModal({onClose}:{onClose:()=>void}){
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'grid', placeItems:'center', zIndex:50}} onClick={onClose}>
      <div className="card" style={{width:600, maxWidth:'90vw', maxHeight:'80vh', overflow:'auto', padding:12}} onClick={e=>e.stopPropagation()}>
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

export function planAutoSave(plan: AutoSaveBootstrapPlan): AutoSaveActivationDecision {
  if (plan.guard.optionsDisabled) {
    return { mode: 'manual-only', guard: plan.guard, reason: 'options-disabled' }
  }
  if (!plan.guard.featureFlag.value) {
    const reason = plan.failSafePhase === 'phase-a0' ? 'phase-a0-failsafe' : 'feature-flag-disabled'
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

export function resolveAutoSaveBootstrapPlanForApp(
  applyPlan: (plan: AutoSaveBootstrapPlan) => void
): AutoSaveBootstrapPlan {
  const plan = resolveAutoSaveBootstrapPlan()
  applyPlan(plan)
  return plan
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

export default function App(){
  const { sb, setSBTitle, addScene } = useSB()
  const [dockOpen, setDockOpen] = useState(()=> getDockOpenPreference())
  const [help, setHelp] = useState(false)
  const [base, setBase] = useState(OLLAMA_BASE)
  const [autoSavePlan, setAutoSavePlan] = useState<AutoSaveBootstrapPlan | null>(null)
  const [autoSaveDecision, setAutoSaveDecision] = useState<AutoSaveActivationDecision | null>(null)
  const autoSaveRunner = useRef<AutoSaveInitResult | null>(null)
  const toolbarNotifiers: ToolbarNotifiers = {
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
    const plan = resolveAutoSaveBootstrapPlan()
    setAutoSavePlan(plan)
  }, [])

  useEffect(()=>{
    if (!autoSavePlan){
      return
    }

    const decision = planAutoSave(autoSavePlan)
    setAutoSaveDecision(decision)
    if (decision.mode !== 'autosave'){
      autoSaveRunner.current?.dispose()
      autoSaveRunner.current = null
      return
    }

    const runner = initAutoSave(
      () => useSB.getState().sb,
      {
        disabled: decision.guard.optionsDisabled
      },
      autoSavePlan.snapshot.autosave
    )
    autoSaveRunner.current = runner

    const unsubscribe = watchAutoSaveStoryboardDiffs(useSB, autoSaveRunner, runner)

    return ()=>{
      unsubscribe()
      if (autoSaveRunner.current === runner){
        autoSaveRunner.current?.dispose()
        autoSaveRunner.current = null
      }
    }
  }, [autoSavePlan])

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
            void handleToolbarSaveProject({
              storyboard: useSB.getState().sb,
              save: saveJSON,
              ...toolbarNotifiers
            })
          }}
        >
          Save Project
        </button>
        <button
          className="btn"
          onClick={() => {
            void handleToolbarLoadProject({
              load: (path) => loadJSON<Storyboard>(path),
              applyStoryboard(storyboard) {
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
            void handleToolbarPackageExport({
              storyboard: useSB.getState().sb,
              build: buildPackage,
              createDownload(content, currentStoryboard) {
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
        <MergeDock />
      </div>
      {help && <HelpModal onClose={()=>setHelp(false)} />}
    </div>
  )
}
