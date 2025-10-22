import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSB } from '../store'
import { toMarkdown, toCSV, toJSONL, downloadText } from '../lib/exporters'
import { mergeCSV, mergeJSONL, readFileAsText, ImportMode } from '../lib/importers'
import { saveText, loadText, ensureDir } from '../lib/opfs'
import { sha256Hex } from '../lib/hash'
import { GoldenCompare } from './GoldenCompare'

type MergePrecision = 'legacy' | 'beta' | 'stable'; const BASE_TAB_IDS = ['compiled', 'shot', 'assets', 'import', 'golden'] as const
type BaseTabId = (typeof BASE_TAB_IDS)[number]; type MergeDockTabId = BaseTabId | 'diff'
type MergeDockTabPlanEntry = { readonly id: MergeDockTabId; readonly label: string; readonly badge?: 'Beta' }
type MergeDockTabPlan = { readonly tabs: readonly MergeDockTabPlanEntry[]; readonly initialTab: MergeDockTabId }

const BASE_TABS = Object.freeze([
  { id: 'compiled', label: 'Compiled Script' }, { id: 'shot', label: 'Shotlist / Export' },
  { id: 'assets', label: 'Assets' }, { id: 'import', label: 'Import' }, { id: 'golden', label: 'Golden' }
] as const satisfies readonly MergeDockTabPlanEntry[])

const isBaseTabId = (value: unknown): value is BaseTabId => typeof value === 'string' && (BASE_TAB_IDS as readonly string[]).includes(value)

export const planMergeDockTabs = (precision: MergePrecision, lastTab?: MergeDockTabId): MergeDockTabPlan => {
  const sanitized = lastTab && (lastTab === 'diff' || isBaseTabId(lastTab)) ? lastTab : undefined
  if (precision === 'legacy') return { tabs: BASE_TABS, initialTab: sanitized && sanitized !== 'diff' ? sanitized : 'compiled' }
  if (precision === 'beta') {
    const tabs = [...BASE_TABS, { id: 'diff', label: 'Diff (Beta)', badge: 'Beta' } satisfies MergeDockTabPlanEntry]; return { tabs, initialTab: sanitized && tabs.some((tab) => tab.id === sanitized) ? sanitized : 'compiled' }
  }
  const tabs = [...BASE_TABS.slice(0, -1), { id: 'diff', label: 'Diff' } satisfies MergeDockTabPlanEntry, BASE_TABS.at(-1)!]; return { tabs, initialTab: 'diff' }
}

function Checks(){
  const { sb } = useSB()
  const warns: string[] = []
  sb.scenes.forEach((s, i)=>{
    if (!(s.manual||s.ai)) warns.push(`#${i+1} text empty`)
    if (!s.tone) warns.push(`#${i+1} tone missing`)
  })
  return (
    <div style={{padding:'6px 10px', color: warns.length? '#b45309':'#15803d'}}>
      {warns.length? `Warnings: ${warns.length}` : 'OK: No issues found'}
      {warns.length? <ul>{warns.map((w,i)=><li key={i}>{w}</li>)}</ul> : null}
    </div>
  )
}

export function MergeDock(){
  const { sb } = useSB()
  const storage = typeof window !== 'undefined' ? window.localStorage : undefined; const backupThresholdMs = 5*60*1000
  const autoSaveInterop = typeof window !== 'undefined' ? (window as typeof window & { __mergeDockAutoSaveSnapshot?: { lastSuccessAt?: string }; __mergeDockFlushNow?: () => void }) : undefined
  const precision = useMemo<MergePrecision>(()=>{
    const candidates = [(import.meta as any)?.env?.VITE_MERGE_PRECISION, storage?.getItem('merge.precision'), storage?.getItem('flag:merge.precision')]
    for (const value of candidates){ if (typeof value === 'string'){ const lower = value.toLowerCase(); if (lower==='legacy'||lower==='beta'||lower==='stable') return lower as MergePrecision } }
    return 'legacy'
  }, [storage])
  const plan = useMemo(()=>{ const stored = storage?.getItem('merge.lastTab'); return planMergeDockTabs(precision, stored==='diff'||isBaseTabId(stored)? stored as MergeDockTabId: undefined) }, [precision, storage])
  const [tab, setTabState] = useState<MergeDockTabId>(plan.initialTab); const [pref, setPref] = useState<'manual-first'|'ai-first'|'diff-merge'>('manual-first')
  const precisionRef = useRef(precision)
  useEffect(()=>{
    if (precisionRef.current !== precision){ precisionRef.current = precision; setTabState(plan.initialTab); storage?.setItem('merge.lastTab', plan.initialTab); return }
    if (!plan.tabs.some(entry=>entry.id===tab)){ setTabState(plan.initialTab); storage?.setItem('merge.lastTab', plan.initialTab) }
  }, [plan, precision, storage, tab])
  const setTab = (next: MergeDockTabId)=>{ setTabState(next); storage?.setItem('merge.lastTab', next) }
  const flushNow = autoSaveInterop?.__mergeDockFlushNow
  const showBackupCTA = (()=>{ if (tab!=='diff' || !flushNow) return false; const last = autoSaveInterop?.__mergeDockAutoSaveSnapshot?.lastSuccessAt; if (!last) return false; const ts = Date.parse(last); return Number.isFinite(ts) && Date.now() - ts > backupThresholdMs })()

  const compiled = useMemo(()=>{
    const lines:string[] = []
    for (let i=0;i<sb.scenes.length;i++){
      const s = sb.scenes[i]
      const pick = s.lock ? (s.lock==='manual'? s.manual: s.ai) :
                   (pref==='manual-first' ? (s.manual || s.ai) :
                    pref==='ai-first' ? (s.ai || s.manual) : (s.manual || s.ai))
      lines.push(`## Cut ${i+1}\n${pick}`)
    }
    return lines.join("\n\n")
  }, [sb, pref])

  async function onImport(file: File, mode: ImportMode){
    const text = await readFileAsText(file)
    if (file.name.endsWith('.jsonl')){
      mergeJSONL(sb, text, mode)
    }else if (file.name.endsWith('.csv')){
      mergeCSV(sb, text, mode)
    }else if (file.name.endsWith('.md')){
      const blocks = text.split(/\n##\s*Cut\s+\d+/).slice(1)
      blocks.forEach((b, i)=>{
        const body = b.replace(/<!--.*?-->/g,'').trim()
        if (sb.scenes[i]){
          (sb.scenes[i] as any)[mode] = body
        }
      })
    }else{
      alert('Unsupported file type. Use .jsonl / .csv / .md')
      return
    }
    alert('Imported (merged).')
  }

  return (
    <div>
      <div className="tabs">
        {plan.tabs.map(entry=>(
          <button
            key={entry.id}
            className={"tab "+(tab===entry.id?'active':'')}
            onClick={()=>setTab(entry.id)}
          >
            {entry.label}
            {entry.badge ? <span style={{marginLeft:4, fontSize:'0.75em', color:'#2563eb'}}>{entry.badge}</span> : null}
          </button>
        ))}
        <div style={{marginLeft:'auto'}}><Checks/></div>
      </div>

      {tab==='diff' && <div style={{padding:8, display:'grid', gap:8}}>
        {showBackupCTA && <button className="btn" onClick={()=>flushNow?.()}>バックアップを今すぐ実行</button>}
        <p style={{margin:'4px 0'}}>Diff Merge ビューは準備中です。</p>
      </div>}

      {tab==='compiled' && (
        <div>
          <div style={{display:'flex', gap:8, padding:8, alignItems:'center'}}>
            <label>統合ルール:</label>
            <select value={pref} onChange={e=>setPref(e.target.value as any)}>
              <option value="manual-first">Manual優先</option>
              <option value="ai-first">AI優先</option>
              <option value="diff-merge">差分マージ（暫定）</option>
            </select>
          </div>
          <pre>{compiled}</pre>
        </div>
      )}

      {tab==='shot' && (
        <div style={{padding:8, display:'grid', gap:8}}>
          <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
            <button className="btn" onClick={()=>downloadText('shotlist.md', toMarkdown(sb))}>Export MD</button>
            <button className="btn" onClick={()=>downloadText('shotlist.csv', toCSV(sb))}>Export CSV</button>
            <button className="btn" onClick={()=>downloadText('shotlist.jsonl', toJSONL(sb))}>Export JSONL</button>
            <button className="btn" onClick={async()=>{
              const ts = new Date().toISOString().replace(/[:.]/g,'-')
              const dir = `runs/${ts}`
              await ensureDir(dir)
              const md = toMarkdown(sb)
              const csv = toCSV(sb)
              const jsonl = toJSONL(sb)
              const h = await sha256Hex(md + '\n' + csv + '\n' + jsonl)
              await saveText(`${dir}/shotlist.md`, md)
              await saveText(`${dir}/shotlist.csv`, csv)
              await saveText(`${dir}/shotlist.jsonl`, jsonl)
              await saveText(`${dir}/meta.json`, JSON.stringify({ hash: h, title: sb.title }, null, 2))
              await saveText('runs/latest.txt', ts)
              alert(`Saved snapshot to OPFS: ${dir}`)
            }}>Save Snapshot (OPFS)</button>
            <button className="btn" onClick={async()=>{
              const latest = await loadText('runs/latest.txt')
              if (!latest){ alert('No snapshot'); return }
              const md = await loadText(`runs/${latest}/shotlist.md`)
              if (md==null){ alert('Missing compiled MD'); return }
              const pre = document.querySelector('pre')
              if (pre) pre.textContent = md
              alert('Restored last compiled MD into preview (not scenes).')
            }}>Restore Last Compiled</button>
          </div>
          <pre>{toCSV(sb)}</pre>
        </div>
      )}

      {tab==='assets' && (
        <div style={{padding:8}}>
          <p style={{margin:'4px 0'}}>登場人物/小道具/背景のカタログ（OPFS保存対応）。</p>
        </div>
      )}

      {tab==='golden' && (
        <GoldenCompare />
      )}

      {tab==='import' && (
        <div style={{padding:8, display:'grid', gap:8}}>
          <div>
            <label>Import JSONL/CSV/MD → 反映先: </label>
            <select id="importMode">
              <option value="manual">manual</option>
              <option value="ai">ai</option>
            </select>
          </div>
          <input type="file" onChange={async e=>{
            const f = e.target.files?.[0]; if (!f) return
            const mode = (document.getElementById('importMode') as HTMLSelectElement).value as any
            await onImport(f, mode)
          }}/>
        </div>
      )}
    </div>
  )
}
