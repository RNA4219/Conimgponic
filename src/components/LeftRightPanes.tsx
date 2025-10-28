import React, { useRef, useState } from 'react'

import { OllamaRequestError, chatStream } from '../lib/ollama'

const MAX_INPUT = 50000

type StringUpdater = (value: string | ((prev: string) => string)) => void

export type ExecuteLeftRightGenerationOptions = {
  readonly getPrompt: () => string
  readonly isBusy: () => boolean
  readonly setBusy: (busy: boolean) => void
  readonly setRight: StringUpdater
  readonly abortRef: { current: AbortController | null }
  readonly alert: (message: string) => void
  readonly consoleError: (...args: unknown[]) => void
  readonly chatStream: typeof chatStream
}

const isAbortError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  if (error instanceof DOMException) {
    return error.name === 'AbortError'
  }
  const candidate = error as { name?: unknown }
  return candidate.name === 'AbortError'
}

export async function executeLeftRightGeneration(options: ExecuteLeftRightGenerationOptions): Promise<void> {
  const { getPrompt, isBusy, setBusy, setRight, abortRef, alert, consoleError, chatStream: stream } = options
  if (isBusy()) return
  const prompt = getPrompt()
  if (prompt.length > MAX_INPUT) {
    alert('入力が長すぎます（50,000文字上限）')
    return
  }
  setBusy(true)
  setRight('')
  const controller = new AbortController()
  abortRef.current = controller
  try {
    for await (const chunk of stream('llama3.1', prompt, { timeoutMs: 60_000, maxChars: 20000, controller })) {
      if (chunk.message?.content) {
        setRight((prev) => prev + chunk.message!.content)
      }
    }
  } catch (error) {
    if (error instanceof OllamaRequestError) {
      alert(error.message)
      consoleError('LeftRight generation failed', error)
      return
    }
    if (isAbortError(error)) {
      alert('生成を中断しました')
      consoleError('LeftRight generation interrupted', error)
      return
    }
    consoleError('LeftRight generation error', error)
    throw error
  } finally {
    abortRef.current = null
    setBusy(false)
  }
}

type KeyboardShortcutEvent = {
  key: string
  ctrlKey: boolean
}

export function isGenerateShortcut(event: KeyboardShortcutEvent): boolean{
  return event.key === 'Enter' && event.ctrlKey
}

export function LeftRight(){
  const [left, setLeft] = useState('')
  const [right, setRight] = useState('')
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController|null>(null)

  async function onGenerate(){
    const notify = typeof alert === 'function' ? alert : () => {}
    try {
      await executeLeftRightGeneration({
        getPrompt: () => left,
        isBusy: () => busy,
        setBusy,
        setRight,
        abortRef,
        alert: notify,
        consoleError: (...args) => console.error(...args),
        chatStream,
      })
    } catch (error) {
      notify('生成処理で予期しないエラーが発生しました')
      console.error('LeftRight generation unexpected error', error)
    }
  }
  function onStop(){
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
  }

  return (
    <div className="split">
      <div className="pane">
        <header>左：手入力</header>
        <textarea
          value={left}
          onChange={e=>setLeft(e.target.value)}
          onKeyDown={event=>{
            if (!isGenerateShortcut(event)) return
            event.preventDefault()
            void onGenerate()
          }}
          placeholder="ここにテキストを貼り付け → 自動分割へ"
        />
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
