import React, { useEffect, useState } from 'react'
import { builtinTemplates, type Template } from '../lib/templates'
import { saveJSON, loadJSON } from '../lib/opfs'

const isTemplate = (value: unknown): value is Template => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<Template>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.text === 'string'
  )
}

export function TemplatesMenu({ onInsert }:{ onInsert:(t:Template)=>void }){
  const [list, setList] = useState<Template[]>(builtinTemplates)
  const [open, setOpen] = useState(false)
  useEffect(()=>{ (async()=>{
    const user = await loadJSON<Template[]>('project/templates.json')
    if (Array.isArray(user)) {
      const sanitized = user.filter(isTemplate)
      setList([...builtinTemplates, ...sanitized])
    }
  })() },[])
  return (
    <div style={{position:'relative'}}>
      <button className="btn" onClick={()=>setOpen(v=>!v)}>テンプレ</button>
      {open && (
        <div style={{position:'absolute', top:'120%', right:0, zIndex:20, background:'#fff', border:'1px solid #e5e5e5', borderRadius:8, minWidth:240, padding:6, boxShadow:'0 6px 24px rgba(0,0,0,.08)'}}>
          {list.map(t=> (
            <div key={t.id} style={{padding:'6px 8px', cursor:'pointer'}} onClick={()=>{ onInsert(t); setOpen(false) }}>{t.name}</div>
          ))}
          <hr />
          <button className="btn" onClick={async()=>{
            const name = prompt('テンプレ名?'); if (!name) return
            const text = prompt('テンプレ本文?'); if (text==null) return
            const id = 'user-' + Math.random().toString(36).slice(2,8)
            const user = await loadJSON<Template[]>('project/templates.json')
            const templates = Array.isArray(user) ? user.filter(isTemplate) : []
            const next = [...templates, { id, name, text }]
            await saveJSON('project/templates.json', next)
            setList([...builtinTemplates, ...next])
          }}>+ 追加</button>
        </div>
      )}
    </div>
  )
}
