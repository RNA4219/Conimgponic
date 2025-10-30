export type { MergeHunk, MergePrecision } from '../lib/merge'

export {
  DIFF_MERGE_TAB_STORAGE_PREFIX,
  PRECISION_PHASE_GUARD,
  SUB_TAB_LABELS,
  createDiffMergeNavigationKeyHandler,
  diffMergeComponentResponsibilities,
  diffMergeViewDesign,
  isDiffMergeDevelopmentEnvironment,
  planDiffMergeSubTabs,
  planDiffMergeView,
  resolveDiffMergeStoredTab,
} from '../lib/merge/diffMergePlan'

export type {
  DiffMergeNavigationKeyEvent,
  DiffMergeNavigationKeyHandler,
  DiffMergeNavigationKeyHandlerOptions,
  DiffMergePaneSpec,
  DiffMergePaneTransition,
  DiffMergeQueueCommandPayload,
  DiffMergeSubTabKey,
  DiffMergeSubTabPlan,
  DiffMergeTabKey,
  DiffMergeTabSpec,
  DiffMergeTabStorage,
  DiffMergeViewDesign,
  DiffMergeViewPlan,
  MergeDecisionEvent,
  PrecisionPhaseGuard,
  QueueMergeCommand,
} from '../lib/merge/diffMergePlan'
