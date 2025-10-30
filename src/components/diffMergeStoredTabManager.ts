import {
  DIFF_MERGE_TAB_STORAGE_PREFIX,
  isDiffMergeDevelopmentEnvironment as isDevelopmentEnvironment,
  resolveDiffMergeStoredTab,
  type DiffMergeSubTabKey,
  type DiffMergeTabStorage,
  type DiffMergeViewPlan,
  type MergePrecision,
} from './diffMergeTypes.js'

export interface DiffMergeStoredTabManagerOptions {
  readonly plan: DiffMergeViewPlan
  readonly precision: MergePrecision
  readonly storage?: DiffMergeTabStorage
}

export interface DiffMergeStoredTabManager {
  readonly allowedTabs: ReadonlySet<DiffMergeSubTabKey>
  readonly resolveInitialTab: (fallback?: DiffMergeSubTabKey | null) => DiffMergeSubTabKey
  readonly persist: (key: DiffMergeSubTabKey) => void
}

export const createDiffMergeStoredTabManager = ({
  plan,
  precision,
  storage,
}: DiffMergeStoredTabManagerOptions): DiffMergeStoredTabManager => {
  const storageKey = `${DIFF_MERGE_TAB_STORAGE_PREFIX}${precision}`
  const allowedTabs = new Set(plan.tabs.map((tab) => tab.key)) as ReadonlySet<DiffMergeSubTabKey>

  const resolveInitialTab = (fallback?: DiffMergeSubTabKey | null) =>
    resolveDiffMergeStoredTab({ plan, precision, storage, fallback })

  const persist = (key: DiffMergeSubTabKey) => {
    if (!allowedTabs.has(key) || !storage) {
      return
    }

    try {
      storage.setItem(storageKey, key)
    } catch (error) {
      if (isDevelopmentEnvironment()) {
        console.warn('DiffMergeView: failed to persist tab selection', error)
      }
    }
  }

  return { allowedTabs, resolveInitialTab, persist }
}
