import React, { useRef, useState } from 'react'
import { chatStream } from '../lib/ollama'

const MAX_INPUT = 50000

export function LeftRight(){
  const [left, setLeft] = useState('')
  const [right, setRight] = useState('')
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController|null>(null)

  async function onGenerate(){
    if (busy) return
    if (left.length > MAX_INPUT){ alert('入力が長すぎます（50,000文字上限）'); return }
    setBusy(true); setRight('')
    abortRef.current = new AbortController()
    const prompt = left
    try{
      for await (const chunk of chatStream('llama3.1', prompt, { timeoutMs: 60_000, maxChars: 20000 })){
        if (chunk.message?.content) setRight(r=> r + chunk.message!.content)
      }
    }finally{
      setBusy(false)
    }
  }
  function onStop(){
    abortRef.current?.abort()
    setBusy(false)
  }

  return (
    <div className="split">
      <div className="pane">
        <header>左：手入力</header>
        <textarea value={left} onChange={e=>setLeft(e.target.value)} placeholder="ここにテキストを貼り付け → 自動分割へ" />
      </div>
      <div className="pane">
        <header>右：生成AI {busy && <span className="badge">生成中…</span>}</header>
        <textarea value={right} onChange={e=>setRight(e.target.value)} placeholder="AIの出力が流れます…" />
        <div style={{display:'flex', gap:8, padding:8}}>
          <button className="btn primary" onClick={onGenerate} disabled={busy}>生成（Ctrl+Enter）</button>
          <button className="btn" onClick={onStop} disabled={!busy}>停止</button>
        </div>
      </div>
    </div>
  )
}
