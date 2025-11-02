import type { ImportMode } from '../../lib/importers'
import type { Storyboard } from '../../types'
import type { MergeDockTabId } from '../../lib/merge/phasePlan'

import type { MergeHunk, QueueMergeCommand } from '../diffMergeTypes.js'

import {
  type MergeDockAutoSaveHeartbeatOptions,
  type MergeDockAutoSaveHeartbeatState,
  type MergeDockAutoSaveState,
  type MergeDockNotice,
  type MergeDockWindow,
} from './model'

export type {
  MergeDockAutoSaveHeartbeatOptions,
  MergeDockAutoSaveHeartbeatState,
  MergeDockAutoSaveState,
  MergeDockNotice,
  MergeDockWindow,
} from './model'

export const readAutoSaveState = (target: MergeDockWindow | undefined): MergeDockAutoSaveState => ({
  flushNow: typeof target?.__mergeDockFlushNow === 'function' ? target.__mergeDockFlushNow : undefined,
  lastSuccessAt: target?.__mergeDockAutoSaveSnapshot?.lastSuccessAt,
})

export const startMergeDockAutoSaveHeartbeat = (
  mergeWindow: MergeDockWindow | undefined,
  listener: (state: MergeDockAutoSaveHeartbeatState) => void,
  options?: MergeDockAutoSaveHeartbeatOptions,
): (() => void) => {
  let disposed = false
  const intervalMs = options?.intervalMs ?? 5_000
  const dispatch = () => {
    if (disposed) return
    listener({ autoSave: readAutoSaveState(mergeWindow), now: Date.now() })
  }
  dispatch()
  if (intervalMs <= 0) {
    return () => {
      disposed = true
    }
  }
  const interval = setInterval(dispatch, intervalMs)
  return () => {
    disposed = true
    clearInterval(interval)
  }
}

const CRLF_PATTERN = /\r\n/g
const COMMENT_BLOCK_WITH_BOUNDARIES_PATTERN = /(?:^|\n)[ \t]*<!--[\s\S]*?-->[ \t]*(?:\n|$)/g
const COMMENT_BLOCK_PATTERN = /<!--[\s\S]*?-->/g
const TRAILING_SPACES_BEFORE_NEWLINE_PATTERN = /[ \t]+\n/g
const EXCESS_NEWLINES_PATTERN = /\n{3,}/g

const removeInlineHtmlComments = (block: string): string => {
  let result = ''
  let cursor = 0
  for (const match of block.matchAll(COMMENT_BLOCK_PATTERN)) {
    const start = match.index ?? 0
    if (start < cursor) {
      continue
    }
    const beforeSegment = block.slice(cursor, start)
    const trimmedBefore = beforeSegment.replace(/[ \t]+$/, '')
    result += trimmedBefore
    const previousChar = trimmedBefore.slice(-1)
    cursor = start + match[0].length
    while (cursor < block.length && (block[cursor] === ' ' || block[cursor] === '\t')) {
      cursor += 1
    }
    const nextChar = block[cursor]
    const hasWordBefore = previousChar !== '' && previousChar !== '\n' && /\S/.test(previousChar)
    const hasWordAfter = nextChar !== undefined && nextChar !== '\n' && /\S/.test(nextChar)
    if (hasWordBefore && hasWordAfter) {
      result += ' '
    }
  }
  result += block.slice(cursor)
  return result
}

const sanitizeMarkdownImportBlock = (block: string): string => {
  const normalized = block
    .replace(CRLF_PATTERN, '\n')
    .replace(COMMENT_BLOCK_WITH_BOUNDARIES_PATTERN, '\n')
  const withoutInlineComments = removeInlineHtmlComments(normalized)
  return withoutInlineComments
    .replace(TRAILING_SPACES_BEFORE_NEWLINE_PATTERN, '\n')
    .replace(EXCESS_NEWLINES_PATTERN, '\n\n')
    .trim()
}

export function mergeMarkdownStoryboard(
  current: Storyboard,
  markdown: string,
  mode: ImportMode,
): Storyboard {
  const blocks = markdown.split(/(?:^|\r?\n)##\s*Cut\s+\d+/).slice(1)
  const scenes = current.scenes.map((scene, index) => {
    const block = blocks[index]
    if (block == null) {
      return { ...scene }
    }
    const normalized = sanitizeMarkdownImportBlock(block)
    return { ...scene, [mode]: normalized }
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
