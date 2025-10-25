import { create } from 'zustand'
import type { Storyboard, Scene } from './types'

const urlAlphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'

const createSceneId = (): string => {
  const buffer = new Uint8Array(8)
  crypto.getRandomValues(buffer)
  let id = ''
  for (const byte of buffer) {
    id += urlAlphabet[byte & 63]
  }
  return id
}

type State = {
  sb: Storyboard
  addScene(): string
  removeScene(id: string): void
  moveScene(id: string, dir: -1|1): void
  updateScene(id: string, patch: Partial<Scene>): void
  setSBTitle(title: string): void
}

type UseSBStore = ReturnType<typeof create<State>>

interface StoreGlobal {
  __conimgponic_sb_store__?: UseSBStore
  __conimgponic_sb_snapshot__?: Storyboard
}

const setSnapshot = (sb: Storyboard): void => {
  const globalRef = globalThis as StoreGlobal
  globalRef.__conimgponic_sb_snapshot__ = sb
}

const createSBStore = (): UseSBStore => {
  const store = create<State>((set, get)=> ({
  sb: { id: 'sb-1', title: 'New Storyboard', scenes: [], selection: [], version: 1, tokens: {
    cinematic: "cinematic tone, dynamic camera, subtle color grading",
    noir: "film noir tone, high contrast lighting, 50mm lens, smoke-filled room",
    anime: "anime storyboard style, vibrant colors, dynamic action lines"
  }},
  addScene(){
    const id = createSceneId()
    set(state => {
      const newScene: Scene = { id, manual: '', ai: '', status: 'idle', assets: [] }
      return {
        sb: {
          ...state.sb,
          scenes: [...state.sb.scenes, newScene],
        },
      }
    })
    return id
  },
  removeScene(id){
    set(state => ({
      sb: {
        ...state.sb,
        scenes: state.sb.scenes.filter(x => x.id !== id),
      },
    }))
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

  setSnapshot(store.getState().sb)
  store.subscribe((state) => {
    setSnapshot(state.sb)
  })
  return store
}

const resolveSBStore = (): UseSBStore => {
  const globalRef = globalThis as StoreGlobal
  if (globalRef.__conimgponic_sb_store__) {
    return globalRef.__conimgponic_sb_store__
  }
  const store = createSBStore()
  globalRef.__conimgponic_sb_store__ = store
  return store
}

export const useSB = resolveSBStore()

export const useSBMeta = () => {
  const { updateScene } = useSB.getState()
  return {
    setSeed: (id: string, seed: number|undefined) => updateScene(id, { seed }),
    setTone: (id: string, tone: string|undefined) => updateScene(id, { tone }),
    setLock: (id: string, lock: 'manual'|'ai'|null) => updateScene(id, { lock }),
  }
}
