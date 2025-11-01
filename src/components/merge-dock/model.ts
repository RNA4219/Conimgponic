import type { DiffBackupAutoSaveState } from '../../lib/merge/diffBackup'

export type MergeDockAutoSaveState = DiffBackupAutoSaveState

export type MergeDockNotice = { readonly level: 'info' | 'error'; readonly message: string }

export type MergeDockWindow = Window & {
  __mergeDockAutoSaveSnapshot?: { lastSuccessAt?: string }
  __mergeDockFlushNow?: () => void
}

export interface MergeDockAutoSaveHeartbeatState {
  readonly autoSave: MergeDockAutoSaveState
  readonly now: number
}

export interface MergeDockAutoSaveHeartbeatOptions {
  readonly intervalMs?: number
}
