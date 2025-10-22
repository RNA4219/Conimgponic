import React, { useEffect, useMemo, useReducer, useState } from 'react'
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

export type DiffMergeSubTabKey = 'review' | 'diff' | 'merged'

export interface DiffMergeEventSpec {
  readonly name: 'tab-change' | 'hunk-toggle' | 'command-queue' | 'edit-open' | 'edit-commit' | 'edit-cancel'
  readonly route: string
  readonly precision: readonly MergePrecision[]
  readonly note: string
}

export interface DiffMergeViewPlan {
  readonly tabs: readonly DiffMergeSubTabKey[]
  readonly initial: DiffMergeSubTabKey
  readonly backupAfterMs?: number
  readonly events: readonly DiffMergeEventSpec[]
}

const BETA_STABLE_EVENTS: readonly DiffMergeEventSpec[] = [
  { name: 'tab-change', route: 'tab-header → ui-state', precision: ['beta', 'stable'], note: 'Review→Diff→Merged の順にナビゲートする' },
  { name: 'command-queue', route: 'action-pane → merge-controller', precision: ['beta', 'stable'], note: 'バックアップCTAの表示条件を評価する' },
  { name: 'edit-open', route: 'hunk-row → ui-state', precision: ['beta', 'stable'], note: 'Diffタブからのみ編集モーダルを開く' },
  { name: 'edit-commit', route: 'modal → merge-controller', precision: ['beta', 'stable'], note: '編集保存後は選択状態を維持する' },
  { name: 'edit-cancel', route: 'modal → ui-state', precision: ['beta', 'stable'], note: 'キャンセル時はタブと選択を復元する' },
]

const DIFF_MERGE_VIEW_PLANS: Record<MergePrecision, DiffMergeViewPlan> = {
  legacy: {
    tabs: ['review'],
    initial: 'review',
    events: [
      { name: 'hunk-toggle', route: 'hunk-row → ui-state', precision: ['legacy'], note: '選択操作で適用対象のみを更新する' },
      { name: 'command-queue', route: 'action-pane → merge-controller', precision: ['legacy'], note: 'バックアップ確認なしで実行' },
    ],
  },
  beta: {
    tabs: ['review', 'diff', 'merged'],
    initial: 'review',
    backupAfterMs: 5 * 60 * 1000,
    events: BETA_STABLE_EVENTS,
  },
  stable: {
    tabs: ['diff', 'merged', 'review'],
    initial: 'diff',
    backupAfterMs: 5 * 60 * 1000,
    events: BETA_STABLE_EVENTS,
  },
}

export const planDiffMergeView = (precision: MergePrecision): DiffMergeViewPlan => DIFF_MERGE_VIEW_PLANS[precision]

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
  const plan = useMemo(() => planDiffMergeView(precision), [precision])
  const [state, dispatch] = useReducer(diffMergeReducer, hunks, createInitialDiffMergeState)
  const [activeSubTab, setActiveSubTab] = useState<DiffMergeSubTabKey>(plan.initial)
  useEffect(() => {
    setActiveSubTab((current) => (plan.tabs.includes(current) ? current : plan.initial))
  }, [plan])
  const controller = useMemo(() => createDiffMergeController({ precision, dispatch, queueMergeCommand, onError }), [precision, queueMergeCommand, onError])
  const selectedIds = useMemo(() => Object.entries(state.hunkStates).filter(([, status]) => status === 'Selected').map(([id]) => id), [state])
  return (
    <div className="diff-merge-view">
      <header role="tablist" aria-label="Diff merge subtabs" className="tab-header"><div className="tab-header__title"><span>Diff Merge</span>{precision === 'beta' && <span className="badge" aria-label="Beta mode">Beta</span>}</div>{plan.tabs.length > 1 && <nav className="tab-header__tabs">{plan.tabs.map((key) => (<button key={key} role="tab" aria-selected={activeSubTab === key} onClick={() => setActiveSubTab(key)}>{key.charAt(0).toUpperCase() + key.slice(1)}</button>))}</nav>}{onCloseDiff && <button type="button" onClick={onCloseDiff} aria-label="Close diff view">×</button>}</header>
      <div className="diff-merge-view__body"><section role="region" aria-label="Hunk list" className="diff-merge-view__hunks"><ul role="list" className="hunk-list">{hunks.map((hunk) => { const status = state.hunkStates[hunk.id]; return <li key={hunk.id} className="hunk-list__item"><div className="hunk-list__header"><button type="button" onClick={() => controller.toggleSelect(hunk.id)} aria-pressed={status === 'Selected'}>{status === 'Selected' ? 'Selected' : 'Select'}</button><span>{hunk.title}</span><button type="button" onClick={() => controller.markSkipped(hunk.id)}>Skip</button><button type="button" onClick={() => controller.openEditor(hunk.id)}>Edit</button></div><pre aria-hidden>{hunk.original}</pre></li>; })}</ul></section><aside className="diff-merge-view__actions" aria-label="Merge actions"><div className="action-pane"><button type="button" onClick={() => controller.queueMerge(selectedIds)} disabled={!selectedIds.length}>Queue Merge</button></div></aside></div>
      {state.editingHunkId && <div role="dialog" aria-modal="true" aria-label="Edit hunk" className="diff-merge-view__modal"><div className="diff-merge-view__modal-content"><p>Editing {state.editingHunkId}</p><button type="button" onClick={() => controller.commitEdit(state.editingHunkId!)}>Save</button><button type="button" onClick={() => controller.cancelEdit()}>Cancel</button></div></div>}
    </div>
  )
}
