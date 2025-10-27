import type {
  DiffMergeQueueCommandPayload,
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

export interface DiffMergeAutoAppliedState {
  readonly rate: number | null
  readonly target: number
  readonly meetsTarget: boolean | null
}

export type DiffMergeAction =
  | { readonly type: 'toggleSelect'; readonly hunkId: string }
  | { readonly type: 'markSkipped'; readonly hunkId: string }
  | { readonly type: 'reset'; readonly hunkId: string }
  | { readonly type: 'resetMany'; readonly hunkIds: readonly string[] }
  | { readonly type: 'openEditor'; readonly hunkId: string }
  | { readonly type: 'commitEdit'; readonly hunkId: string }
  | { readonly type: 'cancelEdit' }
  | { readonly type: 'syncHunks'; readonly hunks: readonly MergeHunk[] }
  | { readonly type: 'queueMerge'; readonly hunkIds: readonly string[] }
  | { readonly type: 'queueResult'; readonly hunkIds: readonly string[]; readonly result: 'success' | 'conflict' | 'error' }
  | { readonly type: 'override'; readonly hunkId: string }
  | { readonly type: 'reopen'; readonly hunkId: string }

const setStatus = (state: DiffMergeState, id: string, status: DiffMergeHunkStatus): DiffMergeState => ({
  ...state,
  hunkStates: { ...state.hunkStates, [id]: status },
})

const buildHunkStateMap = (hunks: readonly MergeHunk[]): Record<string, DiffMergeHunkStatus> =>
  Object.fromEntries(hunks.map((h) => [h.id, 'Unreviewed'] as const)) as Record<string, DiffMergeHunkStatus>

const hasHunkState = (state: DiffMergeState, id: string): boolean =>
  Object.prototype.hasOwnProperty.call(state.hunkStates, id)

const resolveEditingHunkIdAfterTargeting = (
  state: DiffMergeState,
  targeted: ReadonlySet<string>,
): string | null => {
  if (state.editingHunkId === null) return null
  return targeted.has(state.editingHunkId) ? null : state.editingHunkId
}

export const createInitialDiffMergeState = (hunks: readonly MergeHunk[]): DiffMergeState => ({
  hunkStates: buildHunkStateMap(hunks),
  editingHunkId: null,
})

export const diffMergeReducer = (state: DiffMergeState, action: DiffMergeAction): DiffMergeState => {
  if (action.type === 'syncHunks') {
    return {
      hunkStates: buildHunkStateMap(action.hunks),
      editingHunkId: null,
    }
  }
  if (action.type === 'resetMany') {
    if (!action.hunkIds.length) return state
    const updates: Record<string, DiffMergeHunkStatus> = {}
    let changed = false
    let editingHunkId = state.editingHunkId
    for (const id of action.hunkIds) {
      if (!hasHunkState(state, id)) continue
      updates[id] = 'Unreviewed'
      changed = true
      if (editingHunkId === id) editingHunkId = null
    }
    if (!changed) return state
    return { ...state, hunkStates: { ...state.hunkStates, ...updates }, editingHunkId }
  }
  if (action.type === 'toggleSelect') {
    if (!hasHunkState(state, action.hunkId)) return state
    const current = state.hunkStates[action.hunkId] ?? 'Unreviewed'
    const next = current === 'Selected' ? 'Unreviewed' : 'Selected'
    return setStatus(
      { ...state, editingHunkId: next === 'Unreviewed' && state.editingHunkId === action.hunkId ? null : state.editingHunkId },
      action.hunkId,
      next,
    )
  }
  if (action.type === 'markSkipped') {
    if (!hasHunkState(state, action.hunkId)) return state
    return setStatus(state, action.hunkId, 'Skipped')
  }
  if (action.type === 'reset') {
    if (!hasHunkState(state, action.hunkId)) return state
    return setStatus(state, action.hunkId, 'Unreviewed')
  }
  if (action.type === 'openEditor') {
    if (!hasHunkState(state, action.hunkId)) return state
    return { ...setStatus(state, action.hunkId, 'Editing'), editingHunkId: action.hunkId }
  }
  if (action.type === 'commitEdit') {
    if (!hasHunkState(state, action.hunkId)) return state
    return { ...setStatus(state, action.hunkId, 'Selected'), editingHunkId: null }
  }
  if (action.type === 'cancelEdit') return { ...state, editingHunkId: null }
  if (action.type === 'queueMerge') {
    const knownIds = Object.keys(state.hunkStates)
    const ids = retainKnownHunkIds(action.hunkIds, knownIds)
    if (!ids.length) return state
    const updates: Record<string, DiffMergeHunkStatus> = {}
    for (const id of ids) updates[id] = 'Queued'
    const targeted = new Set(ids)
    const editingHunkId = resolveEditingHunkIdAfterTargeting(state, targeted)
    // Guardrails: Day8/workflow-cookbook/GUARDRAILS.md（型安全・最小差分・TDD）に沿って
    // 編集対象をキュー後に閉じる。Day8/docs/day8/guides/07_contributing.md の
    // 「1タスク=1PR」原則に合わせ、最小差分で整える。
    return { ...state, hunkStates: { ...state.hunkStates, ...updates }, editingHunkId }
  }
  if (action.type === 'queueResult') {
    const knownIds = Object.keys(state.hunkStates)
    const ids = retainKnownHunkIds(action.hunkIds, knownIds)
    if (!ids.length) return state
    const updates: Record<string, DiffMergeHunkStatus> = {}
    const status: DiffMergeHunkStatus = action.result === 'success' ? 'Merged' : action.result === 'conflict' ? 'Conflict' : 'Selected'
    for (const id of ids) updates[id] = status
    const targeted = new Set(ids)
    const editingHunkId = resolveEditingHunkIdAfterTargeting(state, targeted)
    // Guardrails: Day8/workflow-cookbook/GUARDRAILS.md（型安全・最小差分・TDD）と
    // Day8/docs/day8/guides/07_contributing.md（1タスク=1PR）を踏まえ、対象ハンクの
    // 解決後に編集モーダルを閉じる。
    return { ...state, hunkStates: { ...state.hunkStates, ...updates }, editingHunkId }
  }
  if (action.type === 'override') {
    if (!hasHunkState(state, action.hunkId)) return state
    return setStatus(state, action.hunkId, 'Merged')
  }
  if (action.type === 'reopen') {
    if (!hasHunkState(state, action.hunkId)) return state
    return setStatus(state, action.hunkId, 'Selected')
  }
  return state
}

const lastTabForPrecision: Record<MergePrecision, DiffMergeSubTabKey> = Object.freeze({ legacy: 'review', beta: 'review', stable: 'diff' })

const resolveAutoSaveRequested = (
  precision: MergePrecision,
  autoApplied: DiffMergeAutoAppliedState | undefined,
): boolean => {
  if (autoApplied?.meetsTarget === false) return false
  return precision !== 'legacy'
}

const toQueuePayload = ({
  precision,
  hunkIds,
  lastTab,
  autoApplied,
}: {
  readonly precision: MergePrecision
  readonly hunkIds: readonly string[]
  readonly lastTab?: DiffMergeSubTabKey | null
  readonly autoApplied?: DiffMergeAutoAppliedState
}) => ({
  type: 'queue-merge' as const,
  precision,
  origin: 'operation-pane.queue' as const,
  hunkIds,
  telemetryContext: {
    collectorSurface: 'diff-merge.operation-pane',
    analyzerSurface: 'diff-merge.queue',
    lastTab: lastTab ?? lastTabForPrecision[precision],
  } satisfies DiffMergeQueueCommandPayload['telemetryContext'],
  metadata: { autoSaveRequested: resolveAutoSaveRequested(precision, autoApplied) },
})

export const retainKnownHunkIds = (
  candidateIds: readonly string[],
  knownIds: readonly string[],
): readonly string[] => {
  if (!candidateIds.length) return []
  const known = new Set(knownIds)
  if (known.size === candidateIds.length && candidateIds.every((id) => known.has(id))) return candidateIds
  return candidateIds.filter((id) => known.has(id))
}

export const createDiffMergeController = ({
  precision,
  dispatch,
  queueMergeCommand,
  getCurrentHunkIds,
  onError,
  resolveCurrentTab,
  autoApplied,
}: {
  readonly precision: MergePrecision
  readonly dispatch: (action: DiffMergeAction) => void
  readonly queueMergeCommand: QueueMergeCommand
  readonly getCurrentHunkIds: () => readonly string[]
  readonly onError?: (event: MergeDecisionEvent) => void
  readonly resolveCurrentTab?: () => DiffMergeSubTabKey | null
  readonly autoApplied?: DiffMergeAutoAppliedState
}) => ({
  queueMerge: async (hunkIds: readonly string[]) => {
    const ids = [...retainKnownHunkIds(hunkIds, getCurrentHunkIds())]
    if (!ids.length) return
    dispatch({ type: 'queueMerge', hunkIds: ids })
    try {
      const result = await queueMergeCommand(
        toQueuePayload({
          precision,
          hunkIds: ids,
          lastTab: resolveCurrentTab?.() ?? null,
          autoApplied,
        }),
      )
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
