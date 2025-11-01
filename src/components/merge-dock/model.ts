import type { ImportMode } from '../../lib/importers'
import type { Storyboard } from '../../types'
import type { DiffBackupAutoSaveState } from '../../lib/merge/diffBackup'
import type { MergeDockTabId } from '../../lib/merge/phasePlan'

import type { MergeHunk, QueueMergeCommand } from '../diffMergeTypes.js'

export type MergeDockNotice = { readonly level: 'info' | 'error'; readonly message: string }

export type MergeDockAutoSaveState = DiffBackupAutoSaveState

export type MergeDockWindow = Window & {
  __mergeDockAutoSaveSnapshot?: { lastSuccessAt?: string }
  __mergeDockFlushNow?: () => void
}

export const readAutoSaveState = (target: MergeDockWindow | undefined): MergeDockAutoSaveState => ({
  flushNow: typeof target?.__mergeDockFlushNow === 'function' ? target.__mergeDockFlushNow : undefined,
  lastSuccessAt: target?.__mergeDockAutoSaveSnapshot?.lastSuccessAt,
})

export function mergeMarkdownStoryboard(
  current: Storyboard,
  markdown: string,
  mode: ImportMode,
): Storyboard {
  const blocks = markdown.split(/(?:^|\r?\n)##\s*Cut\s+\d+/).slice(1)
  const scenes = current.scenes.map((scene, index) => {
    const body = blocks[index]?.replace(/<!--.*?-->/g, '').trim()
    if (body == null) {
      return { ...scene }
    }
    return { ...scene, [mode]: body }
  })
  return { ...current, scenes }
}

export const computeStoryboardWarnings = (storyboard: Storyboard): string[] => {
  const results: string[] = []
  for (let index = 0; index < storyboard.scenes.length; index += 1) {
    const scene = storyboard.scenes[index]!
    if (!(scene.manual || scene.ai)) {
      results.push(`#${index + 1} text empty`)
    }
    if (!scene.tone) {
      results.push(`#${index + 1} tone missing`)
    }
  }
  return results
}

export const emptyDiffHunks: readonly MergeHunk[] = []

export const diffMergeNoopCommand: QueueMergeCommand = async () => ({
  status: 'success',
  hunkIds: [],
  telemetry: { collectorSurface: 'diff-merge.hunk-list', analyzerSurface: 'diff-merge.queue', retryable: false },
})

export {
  diffBackupPolicy,
  planMergeDockTabs,
  resolveMergeDockPhasePlan,
  resolveMergeThresholdPlan,
  shouldShowDiffBackupCTA,
} from '../../lib/merge/phasePlan'

export {
  isDiffBackupCTAEligible,
  shouldEnableDiffInteraction,
  shouldRenderDiffBackupCTA,
} from '../../lib/merge/diffBackup'

export type { MergeDockPhaseStats, MergeDockTabId } from '../../lib/merge/phasePlan'
export type { MergeDockPreference } from '../../lib/merge/mergeDockPreference'
export type { WorkspaceConfiguration } from '../../lib/merge/threshold'
