import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { Storyboard, Scene } from './types'

type State = {
  sb: Storyboard
  addScene(): string
  removeScene(id: string): void
  moveScene(id: string, dir: -1|1): void
  updateScene(id: string, patch: Partial<Scene>): void
  setSBTitle(title: string): void
}

export const useSB = create<State>((set, get)=> ({
  sb: { id: 'sb-1', title: 'New Storyboard', scenes: [], selection: [], version: 1, tokens: {
    cinematic: "cinematic tone, dynamic camera, subtle color grading",
    noir: "film noir tone, high contrast lighting, 50mm lens, smoke-filled room",
    anime: "anime storyboard style, vibrant colors, dynamic action lines"
  }},
  addScene(){
    const id = nanoid(8)
    set(s => { s.sb.scenes.push({ id, manual: '', ai: '', status:'idle', assets: [] }) as any })
    return id
  },
  removeScene(id){
    set(s => { s.sb.scenes = s.sb.scenes.filter(x => x.id !== id) })
  },
  moveScene(id, dir){
    const s = get().sb.scenes
    const i = s.findIndex(x => x.id === id)
    if (i < 0) return
    const j = i + dir
    if (j < 0 || j >= s.length) return
    const tmp = s[i]; s[i]=s[j]; s[j]=tmp
    set(ss=>({sb:{...ss.sb, scenes:[...s]}}))
  },
  updateScene(id, patch){
    set(ss => {
      const ns = ss.sb.scenes.map(x => x.id===id? {...x, ...patch}: x)
      return { sb: {...ss.sb, scenes: ns} }
    })
  },
  setSBTitle(title){ set(ss => ({ sb: {...ss.sb, title} })) }
}))

export const useSBMeta = () => {
  const { updateScene } = useSB.getState()
  return {
    setSeed: (id: string, seed: number|undefined) => updateScene(id, { seed }),
    setTone: (id: string, tone: string|undefined) => updateScene(id, { tone }),
    setLock: (id: string, lock: 'manual'|'ai'|null) => updateScene(id, { lock }),
  }
}
