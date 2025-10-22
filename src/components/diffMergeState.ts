import type {
  DiffMergeSubTabKey,
  MergeDecisionEvent,
  MergeHunk,
  MergePrecision,
  QueueMergeCommand,
} from './DiffMergeView'

export type DiffMergeHunkStatus =
  | 'Unreviewed'
  | 'Selected'
  | 'Skipped'
  | 'Editing'
  | 'Queued'
  | 'Merged'
  | 'Conflict'

export interface DiffMergeState {
  readonly hunkStates: Record<string, DiffMergeHunkStatus>
  readonly editingHunkId: string | null
}

export type DiffMergeAction =
  | { readonly type: 'toggleSelect'; readonly hunkId: string }
  | { readonly type: 'markSkipped'; readonly hunkId: string }
  | { readonly type: 'reset'; readonly hunkId: string }
  | { readonly type: 'openEditor'; readonly hunkId: string }
  | { readonly type: 'commitEdit'; readonly hunkId: string }
  | { readonly type: 'cancelEdit' }
  | { readonly type: 'queueMerge'; readonly hunkIds: readonly string[] }
  | { readonly type: 'queueResult'; readonly hunkIds: readonly string[]; readonly result: 'success' | 'conflict' | 'error' }
  | { readonly type: 'override'; readonly hunkId: string }
  | { readonly type: 'reopen'; readonly hunkId: string }

const setStatus = (state: DiffMergeState, id: string, status: DiffMergeHunkStatus): DiffMergeState => ({
  ...state,
  hunkStates: { ...state.hunkStates, [id]: status },
})

export const createInitialDiffMergeState = (hunks: readonly MergeHunk[]): DiffMergeState => ({
  hunkStates: Object.fromEntries(hunks.map((h) => [h.id, 'Unreviewed'] as const)) as Record<string, DiffMergeHunkStatus>,
  editingHunkId: null,
})

export const diffMergeReducer = (state: DiffMergeState, action: DiffMergeAction): DiffMergeState => {
  if (action.type === 'toggleSelect') {
    const current = state.hunkStates[action.hunkId] ?? 'Unreviewed'
    const next = current === 'Selected' ? 'Unreviewed' : 'Selected'
    return setStatus(
      { ...state, editingHunkId: next === 'Unreviewed' && state.editingHunkId === action.hunkId ? null : state.editingHunkId },
      action.hunkId,
      next,
    )
  }
  if (action.type === 'markSkipped') return setStatus(state, action.hunkId, 'Skipped')
  if (action.type === 'reset') return setStatus(state, action.hunkId, 'Unreviewed')
  if (action.type === 'openEditor') return { ...setStatus(state, action.hunkId, 'Editing'), editingHunkId: action.hunkId }
  if (action.type === 'commitEdit') return { ...setStatus(state, action.hunkId, 'Selected'), editingHunkId: null }
  if (action.type === 'cancelEdit') return { ...state, editingHunkId: null }
  if (action.type === 'queueMerge') {
    const updates: Record<string, DiffMergeHunkStatus> = {}
    for (const id of action.hunkIds) updates[id] = 'Queued'
    return { ...state, hunkStates: { ...state.hunkStates, ...updates } }
  }
  if (action.type === 'queueResult') {
    const updates: Record<string, DiffMergeHunkStatus> = {}
    const status: DiffMergeHunkStatus = action.result === 'success' ? 'Merged' : action.result === 'conflict' ? 'Conflict' : 'Selected'
    for (const id of action.hunkIds) updates[id] = status
    return { ...state, hunkStates: { ...state.hunkStates, ...updates } }
  }
  if (action.type === 'override') return setStatus(state, action.hunkId, 'Merged')
  if (action.type === 'reopen') return setStatus(state, action.hunkId, 'Selected')
  return state
}

const lastTabForPrecision: Record<MergePrecision, DiffMergeSubTabKey> = Object.freeze({ legacy: 'review', beta: 'review', stable: 'diff' })

const toQueuePayload = ({ precision, hunkIds }: { readonly precision: MergePrecision; readonly hunkIds: readonly string[] }) => ({
  type: 'queue-merge' as const,
  precision,
  origin: 'operation-pane.queue' as const,
  hunkIds,
  telemetryContext: { collectorSurface: 'diff-merge.hunk-list' as const, analyzerSurface: 'diff-merge.queue' as const, lastTab: lastTabForPrecision[precision] },
  metadata: { autoSaveRequested: precision !== 'legacy' },
})

export const createDiffMergeController = ({
  precision,
  dispatch,
  queueMergeCommand,
  onError,
}: {
  readonly precision: MergePrecision
  readonly dispatch: (action: DiffMergeAction) => void
  readonly queueMergeCommand: QueueMergeCommand
  readonly onError?: (event: MergeDecisionEvent) => void
}) => ({
  queueMerge: async (hunkIds: readonly string[]) => {
    const ids = [...hunkIds]
    if (!ids.length) return
    dispatch({ type: 'queueMerge', hunkIds: ids })
    try {
      const result = await queueMergeCommand(toQueuePayload({ precision, hunkIds: ids }))
      dispatch({ type: 'queueResult', hunkIds: ids, result: result.status })
      if (result.status === 'error') onError?.(result)
    } catch (error) {
      dispatch({ type: 'queueResult', hunkIds: ids, result: 'error' })
      onError?.({
        status: 'error',
        hunkIds: ids,
        telemetry: { collectorSurface: 'diff-merge.hunk-list', analyzerSurface: 'diff-merge.queue', retryable: true },
      })
      throw error
    }
  },
  openEditor: (hunkId: string) => dispatch({ type: 'openEditor', hunkId }),
  commitEdit: (hunkId: string) => dispatch({ type: 'commitEdit', hunkId }),
  cancelEdit: () => dispatch({ type: 'cancelEdit' }),
  toggleSelect: (hunkId: string) => dispatch({ type: 'toggleSelect', hunkId }),
  markSkipped: (hunkId: string) => dispatch({ type: 'markSkipped', hunkId }),
})
