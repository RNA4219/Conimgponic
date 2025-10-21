import React, { useMemo, useState } from 'react'
import { useSB } from '../store'
import { toMarkdown, toCSV, toJSONL, downloadText } from '../lib/exporters'
import { mergeCSV, mergeJSONL, readFileAsText, ImportMode } from '../lib/importers'
import { saveText, loadText, ensureDir } from '../lib/opfs'
import { sha256Hex } from '../lib/hash'
import { GoldenCompare } from './GoldenCompare'

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
  const [tab, setTab] = useState<'compiled'|'shot'|'assets'|'import'|'golden'>('compiled')
  const [pref, setPref] = useState<'manual-first'|'ai-first'|'diff-merge'>('manual-first')

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
        <button className={"tab "+(tab==='compiled'?'active':'')} onClick={()=>setTab('compiled')}>Compiled Script</button>
        <button className={"tab "+(tab==='shot'?'active':'')} onClick={()=>setTab('shot')}>Shotlist / Export</button>
        <button className={"tab "+(tab==='assets'?'active':'')} onClick={()=>setTab('assets')}>Assets</button>
        <button className={"tab "+(tab==='import'?'active':'')} onClick={()=>setTab('import')}>Import</button>
        <button className={"tab "+(tab==='golden'?'active':'')} onClick={()=>setTab('golden')}>Golden</button>
        <div style={{marginLeft:'auto'}}><Checks/></div>
      </div>

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
