import React, { useEffect, useState } from 'react'
import { useSB } from '../store'
import type { AssetRef } from '../types'
import { saveJSON, loadJSON } from '../lib/opfs'

export function AssetsTab(){
  const { sb } = useSB()
  const [items, setItems] = useState<AssetRef[]>(sb.assetsCatalog || [])

  useEffect(()=>{ (async()=>{
    const saved = await loadJSON('project/assets.json')
    if (saved) setItems(saved)
  })() }, [])

  function add(){
    setItems([...items, { id: Math.random().toString(36).slice(2, 8), kind:'character', label:'New', prompt:'' }])
  }
  async function save(){
    await saveJSON('project/assets.json', items)
    ;(useSB.getState() as any).sb.assetsCatalog = items
    alert('Assets saved to OPFS')
  }
  return (
    <div style={{padding:8, display:'grid', gap:8}}>
      <div>
        <button className="btn" onClick={add}>+ 追加</button>
        <button className="btn" onClick={save} style={{marginLeft:8}}>保存</button>
      </div>
      {items.map((a,i)=> (
        <div key={a.id} className="card" style={{padding:8}}>
          <div style={{display:'grid', gridTemplateColumns:'120px 1fr 1fr 1fr', gap:8}}>
            <select value={a.kind} onChange={e=>{
              const v = e.target.value as any; const ns=[...items]; ns[i] = {...a, kind:v}; setItems(ns)
            }}>
              <option value="character">character</option>
              <option value="prop">prop</option>
              <option value="background">background</option>
            </select>
            <input value={a.label} onChange={e=>{ const ns=[...items]; ns[i]={...a,label:e.target.value}; setItems(ns) }}/>
            <input placeholder="prompt fragment" value={a.prompt||''} onChange={e=>{ const ns=[...items]; ns[i]={...a,prompt:e.target.value}; setItems(ns) }}/>
            <button className="btn" onClick={()=>{ const ns=[...items]; ns.splice(i,1); setItems(ns) }}>×</button>
          </div>
        </div>
      ))}
    </div>
  )
}
