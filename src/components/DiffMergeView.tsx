import React, { useMemo, useReducer, useState } from 'react'
import {
  createDiffMergeController,
  createInitialDiffMergeState,
  diffMergeReducer,
  type DiffMergeState,
  type QueueMergeCommand,
  type MergeDecisionEvent,
} from './diffMergeState'

export type MergePrecision = 'legacy' | 'beta' | 'stable'

export type DiffMergeTabKey = 'summary' | 'hunks'

export interface MergeHunk {
  readonly id: string
  readonly title: string
  readonly original: string
  readonly incoming: string
  readonly status: 'pending' | 'applied' | 'rejected' | 'conflict'
  readonly conflictRange?: { readonly start: number; readonly end: number }
}

export interface MergeCommandResult {
  readonly status: 'ok' | 'error'
  readonly retryable?: boolean
  readonly message?: string
}

export type MergeCommand =
  | { readonly type: 'apply'; readonly hunkId: string }
  | { readonly type: 'reject'; readonly hunkId: string }
  | { readonly type: 'edit'; readonly hunkId: string; readonly patch: string }

export interface DiffMergeViewProps {
  readonly precision: MergePrecision
  readonly hunks: readonly MergeHunk[]
  readonly activeTab?: DiffMergeTabKey
  readonly onTabChange?: (tab: DiffMergeTabKey) => void
  readonly selection?: string | null
  readonly onSelectionChange?: (hunkId: string) => void
  readonly queueMergeCommand: QueueMergeCommand
  readonly onError?: (event: MergeDecisionEvent) => void
  readonly onCloseDiff?: () => void
}

export const DiffMergeView: React.FC<DiffMergeViewProps> = ({ precision, hunks, queueMergeCommand, onCloseDiff, onError }) => {
  const [state, dispatch] = useReducer(diffMergeReducer, hunks, createInitialDiffMergeState)
  const [activeSubTab, setActiveSubTab] = useState<'diff' | 'merged' | 'review'>(precision === 'stable' ? 'diff' : 'review')
  const controller = useMemo(() => createDiffMergeController({ precision, dispatch, queueMergeCommand, onError }), [precision, queueMergeCommand, onError])
  const selectedIds = useMemo(() => Object.entries(state.hunkStates).filter(([, status]) => status === 'Selected').map(([id]) => id), [state])
  return (
    <div className="diff-merge-view">
      <header role="tablist" aria-label="Diff merge subtabs" className="tab-header"><div className="tab-header__title"><span>Diff Merge</span>{precision === 'beta' && <span className="badge" aria-label="Beta mode">Beta</span>}</div>{precision !== 'legacy' && <nav className="tab-header__tabs">{[{ key: 'diff', label: 'Diff' },{ key: 'merged', label: 'Merged' },{ key: 'review', label: 'Review' }].map(({ key, label }) => (<button key={key} role="tab" aria-selected={activeSubTab === key} onClick={() => setActiveSubTab(key)}>{label}</button>))}</nav>}{onCloseDiff && <button type="button" onClick={onCloseDiff} aria-label="Close diff view">×</button>}</header>
      <div className="diff-merge-view__body"><section role="region" aria-label="Hunk list" className="diff-merge-view__hunks"><ul role="list" className="hunk-list">{hunks.map((hunk) => { const status = state.hunkStates[hunk.id]; return <li key={hunk.id} className="hunk-list__item"><div className="hunk-list__header"><button type="button" onClick={() => controller.toggleSelect(hunk.id)} aria-pressed={status === 'Selected'}>{status === 'Selected' ? 'Selected' : 'Select'}</button><span>{hunk.title}</span><button type="button" onClick={() => controller.markSkipped(hunk.id)}>Skip</button><button type="button" onClick={() => controller.openEditor(hunk.id)}>Edit</button></div><pre aria-hidden>{hunk.original}</pre></li>; })}</ul></section><aside className="diff-merge-view__actions" aria-label="Merge actions"><div className="action-pane"><button type="button" onClick={() => controller.queueMerge(selectedIds)} disabled={!selectedIds.length}>Queue Merge</button></div></aside></div>
      {state.editingHunkId && <div role="dialog" aria-modal="true" aria-label="Edit hunk" className="diff-merge-view__modal"><div className="diff-merge-view__modal-content"><p>Editing {state.editingHunkId}</p><button type="button" onClick={() => controller.commitEdit(state.editingHunkId!)}>Save</button><button type="button" onClick={() => controller.cancelEdit()}>Cancel</button></div></div>}
    </div>
  )
}
