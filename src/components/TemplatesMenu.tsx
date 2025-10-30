import React, { useEffect, useState } from 'react'
import { builtinTemplates, type Template } from '../lib/templates'
import { saveJSON, loadJSON } from '../lib/opfs'

export const USER_TEMPLATES_STORAGE_PATH = 'project/templates.json'

const defaultAlertImpl: (message: string) => void =
  typeof globalThis.alert === 'function'
    ? (message) => {
        globalThis.alert(message)
      }
    : () => {}

const defaultConsoleErrorImpl: (...args: unknown[]) => void = (...args) => {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error(...args)
  }
}

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

type SynchronizeTemplatesListOptions = {
  loadJSONImpl: typeof loadJSON
  alertImpl: (message: string) => void
  consoleErrorImpl: (...args: unknown[]) => void
  apply: (next: Template[]) => void
}

export async function synchronizeTemplatesList({
  loadJSONImpl,
  alertImpl,
  consoleErrorImpl,
  apply,
}: SynchronizeTemplatesListOptions): Promise<void> {
  try {
    const userTemplates = await loadJSONImpl<Template[]>(USER_TEMPLATES_STORAGE_PATH)
    if (!Array.isArray(userTemplates)) {
      return
    }
    const sanitized = userTemplates.filter(isTemplate)
    apply([...builtinTemplates, ...sanitized])
  } catch (error) {
    alertImpl('テンプレートの読み込みに失敗しました')
    consoleErrorImpl(
      'TemplatesMenu: failed to load templates from OPFS',
      error
    )
  }
}

type AppendTemplateWithRollbackOptions = {
  loadJSONImpl: typeof loadJSON
  saveJSONImpl: typeof saveJSON
  alertImpl: (message: string) => void
  consoleErrorImpl: (...args: unknown[]) => void
  template: Template
  apply: (next: Template[]) => void
  rollback: () => void
}

export async function appendTemplateWithRollback({
  loadJSONImpl,
  saveJSONImpl,
  alertImpl,
  consoleErrorImpl,
  template,
  apply,
  rollback,
}: AppendTemplateWithRollbackOptions): Promise<void> {
  try {
    const userTemplates = await loadJSONImpl<Template[]>(USER_TEMPLATES_STORAGE_PATH)
    const sanitized = Array.isArray(userTemplates)
      ? userTemplates.filter(isTemplate)
      : []
    const nextUserTemplates = [...sanitized, template]
    await saveJSONImpl(USER_TEMPLATES_STORAGE_PATH, nextUserTemplates)
    apply([...builtinTemplates, ...nextUserTemplates])
  } catch (error) {
    rollback()
    alertImpl('テンプレートの保存に失敗しました')
    consoleErrorImpl(
      'TemplatesMenu: failed to save templates to OPFS',
      error
    )
  }
}

export function TemplatesMenu({
  onInsert,
  loadJSONImpl = loadJSON,
  saveJSONImpl = saveJSON,
  alertImpl = defaultAlertImpl,
  consoleErrorImpl = defaultConsoleErrorImpl,
}: {
  onInsert: (template: Template) => void
  loadJSONImpl?: typeof loadJSON
  saveJSONImpl?: typeof saveJSON
  alertImpl?: (message: string) => void
  consoleErrorImpl?: (...args: unknown[]) => void
}) {
  const [list, setList] = useState<Template[]>(builtinTemplates)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let disposed = false
    void synchronizeTemplatesList({
      loadJSONImpl,
      alertImpl,
      consoleErrorImpl,
      apply: (next) => {
        if (!disposed) {
          setList(next)
        }
      },
    })
    return () => {
      disposed = true
    }
  }, [loadJSONImpl, alertImpl, consoleErrorImpl])
  return (
    <div style={{position:'relative'}}>
      <button className="btn" onClick={()=>setOpen(v=>!v)}>テンプレ</button>
      {open && (
        <div style={{position:'absolute', top:'120%', right:0, zIndex:20, background:'#fff', border:'1px solid #e5e5e5', borderRadius:8, minWidth:240, padding:6, boxShadow:'0 6px 24px rgba(0,0,0,.08)'}}>
          {list.map((t) => (
            <button
              key={t.id}
              type="button"
              style={{
                padding: '6px 8px',
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
                background: 'none',
                border: 'none',
              }}
              onClick={() => {
                onInsert(t)
                setOpen(false)
              }}
            >
              {t.name}
            </button>
          ))}
          <hr />
          <button className="btn" onClick={async()=>{
            const name = prompt('テンプレ名?'); if (!name) return
            const text = prompt('テンプレ本文?'); if (text==null) return
            const id = 'user-' + Math.random().toString(36).slice(2,8)
            const previous = list
            try {
              await appendTemplateWithRollback({
                loadJSONImpl,
                saveJSONImpl,
                alertImpl,
                consoleErrorImpl,
                template: { id, name, text },
                apply: (next) => {
                  setList(next)
                },
                rollback: () => {
                  setList(previous)
                },
              })
            } catch (error) {
              setList(previous)
              alertImpl('テンプレートの保存に失敗しました')
              consoleErrorImpl(
                'TemplatesMenu: failed to append template via menu action',
                error
              )
            }
          }}>+ 追加</button>
        </div>
      )}
    </div>
  )
}
