import React from 'react'

export type MergePrecision = 'legacy' | 'beta' | 'stable'

export interface MergeHunk {
  readonly id: string
  readonly section: string | null
  readonly decision: 'auto' | 'conflict'
  readonly similarity: number
  readonly merged: string
  readonly manual: string
  readonly ai: string
  readonly base: string
  readonly prefer: 'manual' | 'ai' | 'none'
}

export type DiffMergeTabKey = 'summary' | 'hunks'
export type DiffMergeSubTabKey = 'diff' | 'merged' | 'review'

export interface DiffMergeSubTabPlan {
  readonly tabs: readonly DiffMergeSubTabKey[]
  readonly initialTab: DiffMergeSubTabKey
  readonly navigationBadge?: 'beta'
}

export const SUB_TAB_LABELS: Record<DiffMergeSubTabKey, string> = Object.freeze({ diff: 'Diff', merged: 'Merged', review: 'Review' })

export interface PrecisionTabDesign {
  readonly visibleTabs: readonly DiffMergeSubTabKey[]
  readonly initialTab: DiffMergeSubTabKey
  readonly navigationBadge?: 'beta'
}

export const DIFF_MERGE_SUB_TAB_PLAN: Record<MergePrecision, PrecisionTabDesign> = Object.freeze({
  legacy: { visibleTabs: ['review'], initialTab: 'review' },
  beta: { visibleTabs: ['review', 'merged', 'diff'], initialTab: 'review', navigationBadge: 'beta' },
  stable: { visibleTabs: ['diff', 'merged', 'review'], initialTab: 'diff' },
})

export const planDiffMergeSubTabs = (precision: MergePrecision): DiffMergeSubTabPlan => {
  const design = DIFF_MERGE_SUB_TAB_PLAN[precision]
  return { tabs: design.visibleTabs, initialTab: design.initialTab, navigationBadge: design.navigationBadge }
}

export interface DiffMergePaneTransition {
  readonly from: 'idle' | 'selected' | 'editing' | 'queued' | 'resolved'
  readonly to: 'idle' | 'selected' | 'editing' | 'queued' | 'resolved'
  readonly trigger:
    | 'toggle-select'
    | 'open-editor'
    | 'commit-edit'
    | 'cancel-edit'
    | 'queue-merge'
    | 'queue-result-success'
    | 'queue-result-conflict'
    | 'queue-result-error'
    | 'mark-skipped'
    | 'override'
    | 'reopen'
  readonly surface: 'HunkList' | 'OperationPane' | 'EditModal'
  readonly telemetryEvent: 'collector:merge.hunk' | 'analyzer:merge.queue' | 'collector:merge.override'
}

export interface DiffMergePaneSpec {
  readonly key: 'hunk-list' | 'operation-pane' | 'edit-modal'
  readonly title: string
  readonly description: string
  readonly renderedWithin: 'DiffMergeTabs'
  readonly transitions: readonly DiffMergePaneTransition[]
  readonly visibility: { readonly type: 'persistent' } | { readonly type: 'conditional'; readonly when: 'editing-hunk-open' | 'has-selection' }
  readonly telemetrySurface: 'collector' | 'analyzer'
}

export interface DiffMergeTabSpec {
  readonly key: DiffMergeTabKey
  readonly panes: readonly DiffMergePaneSpec[]
  readonly defaultFocusPane: DiffMergePaneSpec['key']
  readonly precisionRules: readonly MergePrecision[]
}

export interface DiffMergeQueueCommandPayload {
  readonly type: 'queue-merge'
  readonly precision: MergePrecision
  readonly origin: 'operation-pane.queue' | 'hunk-list.action' | 'edit-modal.commit'
  readonly hunkIds: readonly string[]
  readonly telemetryContext: {
    readonly collectorSurface: 'diff-merge.hunk-list' | 'diff-merge.operation-pane'
    readonly analyzerSurface: 'diff-merge.queue'
    readonly lastTab: DiffMergeSubTabKey
  }
  readonly metadata: { readonly autoSaveRequested: boolean; readonly retryOf?: 'auto' | 'conflict' }
}

export interface MergeDecisionEvent {
  readonly status: 'success' | 'conflict' | 'error'
  readonly hunkIds: readonly string[]
  readonly telemetry: {
    readonly collectorSurface: 'diff-merge.hunk-list'
    readonly analyzerSurface: 'diff-merge.queue'
    readonly retryable: boolean
  }
}

export type QueueMergeCommand = (payload: DiffMergeQueueCommandPayload) => Promise<MergeDecisionEvent>

export interface DiffMergeViewDesign {
  readonly precisionTabs: Record<MergePrecision, DiffMergeSubTabPlan>
  readonly panes: readonly DiffMergePaneSpec[]
  readonly tabs: readonly DiffMergeTabSpec[]
  readonly queueContract: { readonly request: DiffMergeQueueCommandPayload; readonly response: MergeDecisionEvent }
  readonly flowDiagrams: Record<MergePrecision, string>
  readonly componentResponsibilities: readonly {
    readonly component: 'DiffMergeTabs' | 'HunkList' | 'OperationPane' | 'EditModal'
    readonly responsibilities: readonly string[]
    readonly telemetry: readonly string[]
  }[]
}

const hunkTransitions = Object.freeze<DiffMergePaneTransition[]>([
  { from: 'idle', to: 'selected', trigger: 'toggle-select', surface: 'HunkList', telemetryEvent: 'collector:merge.hunk' },
  { from: 'selected', to: 'editing', trigger: 'open-editor', surface: 'HunkList', telemetryEvent: 'collector:merge.hunk' },
  { from: 'editing', to: 'selected', trigger: 'commit-edit', surface: 'EditModal', telemetryEvent: 'collector:merge.hunk' },
  { from: 'editing', to: 'idle', trigger: 'cancel-edit', surface: 'EditModal', telemetryEvent: 'collector:merge.hunk' },
  { from: 'selected', to: 'queued', trigger: 'queue-merge', surface: 'OperationPane', telemetryEvent: 'analyzer:merge.queue' },
  { from: 'queued', to: 'resolved', trigger: 'queue-result-success', surface: 'OperationPane', telemetryEvent: 'analyzer:merge.queue' },
  { from: 'queued', to: 'selected', trigger: 'queue-result-conflict', surface: 'OperationPane', telemetryEvent: 'analyzer:merge.queue' },
  { from: 'queued', to: 'selected', trigger: 'queue-result-error', surface: 'OperationPane', telemetryEvent: 'collector:merge.override' },
  { from: 'selected', to: 'idle', trigger: 'mark-skipped', surface: 'HunkList', telemetryEvent: 'collector:merge.hunk' },
  { from: 'resolved', to: 'selected', trigger: 'reopen', surface: 'OperationPane', telemetryEvent: 'collector:merge.override' },
  { from: 'selected', to: 'resolved', trigger: 'override', surface: 'OperationPane', telemetryEvent: 'collector:merge.override' },
])

const panes = Object.freeze<DiffMergePaneSpec[]>([
  { key: 'hunk-list', title: 'HunkList', description: 'Displays storyboard diff hunks with selection, skip, and edit affordances.', renderedWithin: 'DiffMergeTabs', transitions: hunkTransitions, visibility: { type: 'persistent' }, telemetrySurface: 'collector' },
  { key: 'operation-pane', title: 'OperationPane', description: 'Hosts queue trigger actions and merge progress indicators.', renderedWithin: 'DiffMergeTabs', transitions: hunkTransitions.filter((transition) => transition.surface === 'OperationPane'), visibility: { type: 'conditional', when: 'has-selection' }, telemetrySurface: 'analyzer' },
  { key: 'edit-modal', title: 'EditModal', description: 'Inline editor for manual overrides with commit/cancel operations.', renderedWithin: 'DiffMergeTabs', transitions: hunkTransitions.filter((transition) => transition.surface === 'EditModal'), visibility: { type: 'conditional', when: 'editing-hunk-open' }, telemetrySurface: 'collector' },
])

const flowDiagrams = Object.freeze<Record<MergePrecision, string>>({
  legacy: 'mermaid\nstateDiagram-v2\n  [*] --> Review\n  Review --> Review: toggle-select | mark-skipped\n  Review --> Review: override | reopen\n  Review --> [*]: queue-merge\n',
  beta: 'mermaid\nstateDiagram-v2\n  [*] --> Review\n  Review --> Merged: queue-merge\n  Review --> Edit: open-editor\n  Edit --> Review: commit-edit\n  Edit --> Review: cancel-edit\n  Merged --> Review: reopen | queue-result-conflict | queue-result-error\n  Merged --> Done: queue-result-success\n  Done --> Review: reopen\n  Review --> Diff: select-tab(diff)\n  Diff --> Review: select-tab(review)\n',
  stable: 'mermaid\nstateDiagram-v2\n  [*] --> Diff\n  Diff --> Review: select-tab(review)\n  Review --> Merged: queue-merge\n  Review --> Edit: open-editor\n  Edit --> Review: commit-edit\n  Edit --> Diff: cancel-edit\n  Merged --> Diff: queue-result-success\n  Merged --> Review: queue-result-conflict | queue-result-error\n  Diff --> [*]: close\n',
})

export const diffMergeComponentResponsibilities: DiffMergeViewDesign['componentResponsibilities'] = [
  { component: 'DiffMergeTabs', responsibilities: ['Resolve merge.precision to determine tab exposure and initial selection.', 'Persist last active tab for stable precision and restore on remount.', 'Propagate telemetry surfaces when tab switches occur to keep Collector/Analyzer alignment.'], telemetry: ['collector:merge.tabs', 'analyzer:merge.tabs'] },
  { component: 'HunkList', responsibilities: ['Render storyboard hunks with status badges and CTA buttons.', 'Emit selection, skip, and edit events with collector metadata.', 'Provide hover affordances to open OperationPane tooltips.'], telemetry: ['collector:merge.hunk'] },
  { component: 'OperationPane', responsibilities: ['Aggregate selected hunk IDs and trigger queueMergeCommand.', 'Map MergeDecisionEvent responses to diffMergeReducer actions.', 'Surface Analyzer progress metrics and route retry flows.'], telemetry: ['analyzer:merge.queue'] },
  { component: 'EditModal', responsibilities: ['Allow manual edits guarded by merge.precision threshold prompts.', 'Emit commit/cancel events with collector telemetry payloads.', 'Synchronise editing state with OperationPane availability.'], telemetry: ['collector:merge.hunk'] },
]

export const diffMergeViewDesign: DiffMergeViewDesign = Object.freeze({
  precisionTabs: { legacy: planDiffMergeSubTabs('legacy'), beta: planDiffMergeSubTabs('beta'), stable: planDiffMergeSubTabs('stable') },
  panes,
  tabs: [
    { key: 'summary', panes: [panes[0]], defaultFocusPane: 'hunk-list', precisionRules: ['legacy'] },
    { key: 'hunks', panes, defaultFocusPane: 'hunk-list', precisionRules: ['beta', 'stable'] },
  ],
  queueContract: {
    request: {
      type: 'queue-merge',
      precision: 'beta',
      origin: 'operation-pane.queue',
      hunkIds: [],
      telemetryContext: { collectorSurface: 'diff-merge.hunk-list', analyzerSurface: 'diff-merge.queue', lastTab: 'review' },
      metadata: { autoSaveRequested: false },
    },
    response: {
      status: 'success',
      hunkIds: [],
      telemetry: { collectorSurface: 'diff-merge.hunk-list', analyzerSurface: 'diff-merge.queue', retryable: false },
    },
  },
  flowDiagrams,
  componentResponsibilities: diffMergeComponentResponsibilities,
})

export interface DiffMergeViewProps {
  readonly precision: MergePrecision
  readonly hunks: readonly MergeHunk[]
  readonly queueMergeCommand: QueueMergeCommand
}

export const DiffMergeView: React.FC<DiffMergeViewProps> = () => null
