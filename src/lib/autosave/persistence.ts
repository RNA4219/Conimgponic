import type { Storyboard } from '../../types'

import { AUTOSAVE_DEFAULTS } from './policy.ts'

export interface AutoSaveHistoryEntry {
  readonly ts: string
  readonly bytes: number
  readonly location: 'current' | 'history'
  readonly retained: boolean
}

export interface AutoSaveHistoryRotationPlan {
  readonly targetDirectory: string
  readonly indexFile: string
  readonly currentFile: string
  readonly maxGenerations: number
  readonly maxBytes: number
  readonly gcOrder: 'fifo'
  readonly cleanupOrphans: boolean
}

export const AUTOSAVE_HISTORY_ROTATION_PLAN: AutoSaveHistoryRotationPlan = Object.freeze({
  targetDirectory: 'project/autosave',
  indexFile: 'project/autosave/index.json',
  currentFile: 'project/autosave/current.json',
  maxGenerations: AUTOSAVE_DEFAULTS.maxGenerations,
  maxBytes: AUTOSAVE_DEFAULTS.maxBytes,
  gcOrder: 'fifo',
  cleanupOrphans: true
})

export interface AutoSavePersistenceContract {
  readonly writeCurrent: (payload: Storyboard) => Promise<{ bytes: number }>
  readonly updateIndex: (entry: AutoSaveHistoryEntry) => Promise<void>
  readonly rotateHistory: (
    entries: readonly AutoSaveHistoryEntry[],
    options?: { enforceBytes?: boolean }
  ) => Promise<readonly AutoSaveHistoryEntry[]>
}
