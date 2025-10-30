import type { MergeDockTabId } from './phasePlan'
import {
  getDefaultPreference,
  resolveActiveTabTransition,
  resolvePreferenceSelection,
  sanitizeMergeDockActiveTab,
  sanitizePreference,
  type MergeDockPreference,
} from './preferences'

export type { MergeDockPreference }
export {
  getDefaultPreference,
  resolveActiveTabTransition,
  resolvePreferenceSelection,
  sanitizeMergeDockActiveTab,
  sanitizePreference,
}

export type MergeDockPersistenceLogger = Pick<Console, 'warn'>

export interface PersistMergeDockActiveTabOptions {
  readonly storage: Pick<Storage, 'setItem'>
  readonly storageKey: string
  readonly tab: MergeDockTabId
  readonly logger?: MergeDockPersistenceLogger | null
}

export function persistMergeDockActiveTab({
  storage,
  storageKey,
  tab,
  logger,
}: PersistMergeDockActiveTabOptions): boolean {
  try {
    storage.setItem(storageKey, tab)
    return true
  } catch (error) {
    const resolvedLogger: MergeDockPersistenceLogger =
      logger && typeof logger.warn === 'function' ? logger : console
    resolvedLogger.warn(
      'MergeDock: failed to persist active tab. Falling back without localStorage.',
      storageKey,
      tab,
      error,
    )
    return false
  }
}
