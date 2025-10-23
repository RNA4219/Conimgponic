import React, { useEffect, useRef, useState } from 'react'
import { useSB } from './store'
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
import { initAutoSave, type AutoSaveInitResult, type AutoSavePhaseGuardSnapshot } from './lib/autosave'

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

type Day8CollectorGuardEvent = {
  readonly feature: 'autosave-diff-merge'
  readonly event: 'autosave.guard'
  readonly blocked: boolean
  readonly reason: AutoSaveActivationDecision['reason']
  readonly guard: AutoSavePhaseGuardSnapshot
  readonly ts: string
}

interface Day8Collector {
  publish(event: Day8CollectorGuardEvent): void
}

const getDay8Collector = (): Day8Collector | undefined => {
  const scope = globalThis as { Day8Collector?: Day8Collector }
  const candidate = scope.Day8Collector
  return candidate && typeof candidate.publish === 'function' ? candidate : undefined
}

export type AutoSaveActivationDecision =
  | {
      readonly mode: 'manual-only'
      readonly guard: AutoSavePhaseGuardSnapshot
      readonly reason: 'phase-a0-failsafe' | 'feature-flag-disabled'
    }
  | {
      readonly mode: 'autosave'
      readonly guard: AutoSavePhaseGuardSnapshot
      readonly reason: 'feature-flag-enabled'
    }

export function planAutoSave(plan: AutoSaveBootstrapPlan): AutoSaveActivationDecision {
  if (plan.guard.optionsDisabled) {
    return { mode: 'manual-only', guard: plan.guard, reason: 'feature-flag-disabled' }
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

export default function App(){
  const { sb, setSBTitle, addScene } = useSB()
  const [dockOpen, setDockOpen] = useState(()=> (localStorage.getItem('dockOpen')==='0'? false: true))
  const [help, setHelp] = useState(false)
  const [base, setBase] = useState(OLLAMA_BASE)
  const [autoSavePlan, setAutoSavePlan] = useState<AutoSaveBootstrapPlan | null>(null)
  const [autoSaveDecision, setAutoSaveDecision] = useState<AutoSaveActivationDecision | null>(null)
  const autoSaveRunner = useRef<AutoSaveInitResult | null>(null)

  useEffect(()=>{
    function onKey(e: KeyboardEvent){
      try{
        if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase()==='s'){
          e.preventDefault(); (async()=>{ await saveJSON('project/storyboard.json', useSB.getState().sb) })();
        } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='s'){
          e.preventDefault(); (async()=>{
            const { ensureDir, saveText } = await import('./lib/opfs');
            const { toMarkdown, toCSV, toJSONL } = await import('./lib/exporters');
            const { sha256Hex } = await import('./lib/hash');
            const sb = useSB.getState().sb
            const ts = new Date().toISOString().replace(/[:.]/g,'-'); const dir = `runs/${ts}`; await ensureDir(dir)
            const md = toMarkdown(sb), csv = toCSV(sb), jsonl=toJSONL(sb), h = await sha256Hex(md + '\n' + csv + '\n' + jsonl)
            await saveText(`${dir}/shotlist.md`, md); await saveText(`${dir}/shotlist.csv`, csv); await saveText(`${dir}/shotlist.jsonl`, jsonl); await saveText(`${dir}/meta.json`, JSON.stringify({hash:h,title:sb.title},null,2)); await saveText('runs/latest.txt', ts)
          })();
        } else if (e.ctrlKey && e.altKey && e.key.toLowerCase()==='n'){
          e.preventDefault(); useSB.getState().addScene()
        } else if (e.ctrlKey && e.key === 'Enter'){
          // noop: LeftRight component handles generation
        }
      }catch{}
    }
    window.addEventListener('keydown', onKey)
    return ()=> window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(()=>{
    setAutoSavePlan(resolveAutoSaveBootstrapPlan())
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

    return ()=>{
      autoSaveRunner.current?.dispose()
      autoSaveRunner.current = null
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
        <button className="btn" onClick={async()=>{ const sb = useSB.getState().sb; await saveJSON('project/storyboard.json', sb); alert('Saved to OPFS: project/storyboard.json') }}>Save Project</button>
        <button className="btn" onClick={async()=>{ const s = await loadJSON('project/storyboard.json'); if (s){ useSB.setState({ sb: s }); alert('Loaded from OPFS') }else alert('No project found') }}>Load Project</button>
        <button className="btn" onClick={()=>addScene()}>+ カード</button>
        <button className="btn" onClick={()=>setDockOpen(v=>{ const nv=!v; localStorage.setItem('dockOpen', nv? '1':'0'); return nv })}>{dockOpen?'統合 ⌃':'統合 ⌄'}</button>
        <button className="btn" onClick={async()=>{
          const sb = useSB.getState().sb
          const pkg = await buildPackage(sb)
          const blob = new Blob([pkg], {type:'application/json'})
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (sb.title||'project') + '.imgponic.json'; a.click(); setTimeout(()=> URL.revokeObjectURL(a.href), 2000)
        }}>Package Export</button>
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
