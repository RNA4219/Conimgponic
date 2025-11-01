import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

import type { MergeDockPreference } from '../../lib/merge/mergeDockPreference'
import type { MergeDockTabId } from '../../lib/merge/phasePlan'

export interface MergeDockViewState {
  readonly activeTab: MergeDockTabId
  readonly preference: MergeDockPreference
  readonly setActiveTab: (tab: MergeDockTabId) => void
  readonly setPreference: (preference: MergeDockPreference) => void
}

export type MergeDockViewStore = StoreApi<MergeDockViewState>

export const createMergeDockViewStore = (
  initialTab: MergeDockTabId,
  preference: MergeDockPreference,
): MergeDockViewStore =>
  createStore<MergeDockViewState>((set) => ({
    activeTab: initialTab,
    preference,
    setActiveTab: (tab) => set({ activeTab: tab }),
    setPreference: (next) => set({ preference: next }),
  }))

export const useMergeDockViewStore = <Result>(
  store: MergeDockViewStore,
  selector: (state: MergeDockViewState) => Result,
): Result => useStore(store, selector)
