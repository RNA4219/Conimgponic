import React, { useEffect, useState } from 'react'
import { useSB } from '../store'
import type { AssetRef } from '../types'
import { saveJSON, loadJSON } from '../lib/opfs'

const isAssetRef = (value: unknown): value is AssetRef => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<AssetRef>
  return (
    typeof candidate.id === 'string' &&
    (candidate.kind === 'character' || candidate.kind === 'prop' || candidate.kind === 'background') &&
    typeof candidate.label === 'string'
  )
}

export function AssetsTab(){
  const { sb } = useSB()
  const [items, setItems] = useState<AssetRef[]>(() =>
    Array.isArray(sb.assetsCatalog) ? sb.assetsCatalog.filter(isAssetRef) : []
  )

  useEffect(()=>{ (async()=>{
    const saved = await loadJSON<AssetRef[]>('project/assets.json')
    if (Array.isArray(saved) && saved.every(isAssetRef)) {
      setItems(saved)
    }
  })() }, [])

  function add(){
    setItems([...items, { id: Math.random().toString(36).slice(2, 8), kind:'character', label:'New', prompt:'' }])
  }
  async function save(){
    await saveJSON('project/assets.json', items)
    useSB.setState((state) => ({ sb: { ...state.sb, assetsCatalog: items } }))
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
              const v = e.target.value as AssetRef['kind']
              const ns=[...items]; ns[i] = {...a, kind:v}; setItems(ns)
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
