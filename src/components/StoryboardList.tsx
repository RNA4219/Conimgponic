import React from 'react'

import type { Scene } from '../types'
import { useSB } from '../store'

type NumericField = 'take'|'seed'

type ApplyNumericFieldChangeParams = {
  field: NumericField
  rawValue: string
  sceneId: string
  updateScene: (id: string, patch: Partial<Scene>) => void
  warn?: (message: string) => void
}

export function applyNumericFieldChange({
  field,
  rawValue,
  sceneId,
  updateScene,
  warn,
}: ApplyNumericFieldChangeParams): void {
  const warnImpl = warn ?? console.warn
  const normalized = rawValue.trim()
  const patch: Partial<Pick<Scene, NumericField>> = {}

  if (normalized === '') {
    patch[field] = undefined
    updateScene(sceneId, patch as Partial<Scene>)
    return
  }

  const parsed = Number(normalized)
  if (Number.isFinite(parsed)) {
    patch[field] = parsed
    updateScene(sceneId, patch as Partial<Scene>)
    return
  }

  warnImpl(`StoryboardList: ${field} requires a finite number (received "${rawValue}"); preserving previous value`)
}

export function StoryboardList(){
  const { sb, addScene, removeScene, moveScene, updateScene } = useSB()
  return (
    <div className="list">
      {sb.scenes.map((sc, i)=> (
        <div key={sc.id} className="card">
          <header>
            <strong>#{i+1}</strong>
            <span className="badge">id:{sc.id}</span>
            <label style={{marginLeft:8}}>slate:</label>
            <input style={{width:100}} value={sc.slate ?? ''} onChange={e=>updateScene(sc.id, { slate: e.target.value || undefined })} />
            <label style={{marginLeft:8}}>shot:</label>
            <input style={{width:80}} value={sc.shot ?? ''} onChange={e=>updateScene(sc.id, { shot: e.target.value || undefined })} />
            <label style={{marginLeft:8}}>take:</label>
            <input
              style={{width:60}}
              value={sc.take ?? ''}
              onChange={e=>applyNumericFieldChange({
                field: 'take',
                rawValue: e.target.value,
                sceneId: sc.id,
                updateScene,
              })}
            />
            <label style={{marginLeft:8}}>seed:</label>
            <input
              style={{width:80}}
              value={sc.seed ?? ''}
              onChange={e=>applyNumericFieldChange({
                field: 'seed',
                rawValue: e.target.value,
                sceneId: sc.id,
                updateScene,
              })}
            />
            <label style={{marginLeft:8}}>tone:</label>
            <input style={{width:140}} value={sc.tone ?? ''} onChange={e=>updateScene(sc.id, { tone: e.target.value || undefined })} placeholder="cinematic / noir / anime"/>
            <label style={{marginLeft:8}}>lock:</label>
            <select
              value={sc.lock ?? ''}
              onChange={e=>{
                const value = e.target.value as '' | 'manual' | 'ai'
                updateScene(sc.id, { lock: value === '' ? null : value })
              }}
            >
              <option value="">(none)</option>
              <option value="manual">manual</option>
              <option value="ai">ai</option>
            </select>
            <span style={{marginLeft:'auto'}}></span>
            <button className="btn" onClick={()=>moveScene(sc.id, -1)}>↑</button>
            <button className="btn" onClick={()=>moveScene(sc.id, +1)}>↓</button>
            <button className="btn" onClick={()=>removeScene(sc.id)}>×</button>
          </header>
          <div className="content">
            <textarea value={sc.manual} onChange={e=>updateScene(sc.id, {manual:e.target.value})} placeholder="Manual（採用時はこちらが優先）"/>
            <textarea value={sc.ai} onChange={e=>updateScene(sc.id, {ai:e.target.value})} placeholder="AI下書き"/>
          </div>
        </div>
      ))}
      <button className="btn" onClick={()=>addScene()}>+ カードを追加</button>
    </div>
  )
}
