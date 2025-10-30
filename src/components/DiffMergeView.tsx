import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'

import {
  createDiffMergeNavigationKeyHandler,
  isDiffMergeDevelopmentEnvironment as isDevelopmentEnvironment,
  planDiffMergeView,
  type DiffMergeTabStorage,
} from './diffMergeTypes.js'
import { createDiffMergeStoredTabManager } from './diffMergeStoredTabManager.js'
import type {
  DiffMergeSubTabKey,
  DiffMergeViewPlan,
  MergeHunk,
  MergePrecision,
  QueueMergeCommand,
} from './diffMergeTypes.js'

import {
  createDiffMergeController,
  createInitialDiffMergeState,
  diffMergeReducer,
  retainKnownHunkIds,
  type DiffMergeAutoAppliedState,
  type DiffMergeState,
} from './diffMergeState.js'

type DiffMergeController = ReturnType<typeof createDiffMergeController>

interface DiffMergeNavigationProps {
  readonly precision: MergePrecision
  readonly navigationBadge: DiffMergeViewPlan['navigationBadge']
  readonly tabs: DiffMergeViewPlan['tabs']
  readonly activeTab: DiffMergeSubTabKey
  readonly onSelect: (key: DiffMergeSubTabKey) => void
  readonly onKeyDown: React.KeyboardEventHandler<HTMLElement>
}

const DiffMergeNavigation: React.FC<DiffMergeNavigationProps> = ({
  precision,
  navigationBadge,
  tabs,
  activeTab,
  onSelect,
  onKeyDown,
}) => (
  <nav
    role="tablist"
    data-block="navigation"
    data-precision={precision}
    data-navigation-badge={navigationBadge ?? undefined}
    aria-keyshortcuts="ArrowLeft ArrowRight"
    onKeyDown={onKeyDown}
  >
    {tabs.map((tab) => {
      const badge = tab.badge ? <span data-badge={tab.badge}>{tab.badge.toUpperCase()}</span> : null
      return (
        <button
          key={tab.key}
          type="button"
          role="tab"
          data-testid={`diff-merge-tab-${tab.key}`}
          data-tab={tab.key}
          aria-selected={tab.key === activeTab}
          onClick={() => onSelect(tab.key)}
        >
          {tab.label}
          {badge}
        </button>
      )
    })}
  </nav>
)

interface DiffMergeHunkListProps {
  readonly visible: boolean
  readonly hunks: readonly MergeHunk[]
  readonly hunkStates: DiffMergeState['hunkStates']
  readonly controller: DiffMergeController
}

const DiffMergeHunkList: React.FC<DiffMergeHunkListProps> = ({ visible, hunks, hunkStates, controller }) => {
  if (!visible) return null
  return (
    <section data-block="hunk-list" data-testid="diff-merge-hunk-list">
      {hunks.map((hunk) => {
        const status = hunkStates[hunk.id] ?? 'Unreviewed'
        const isSelected = status === 'Selected' || status === 'Editing'
        return (
          <article key={hunk.id} data-testid={`diff-merge-hunk-${hunk.id}`} data-hunk={hunk.id} data-status={status}>
            <header>{hunk.section ?? hunk.id}</header>
            <div>
              <button
                type="button"
                data-testid={`diff-merge-hunk-${hunk.id}-toggle`}
                data-hunk={hunk.id}
                aria-pressed={isSelected}
                onClick={() => controller.toggleSelect(hunk.id)}
              >
                Toggle
              </button>
              <button
                type="button"
                data-testid={`diff-merge-hunk-${hunk.id}-edit`}
                onClick={() => controller.openEditor(hunk.id)}
              >
                Edit
              </button>
            </div>
          </article>
        )
      })}
    </section>
  )
}

interface DiffMergeOperationPaneProps {
  readonly visible: boolean
  readonly selectedCount: number
  readonly queueCandidateIds: readonly string[]
  readonly controller: DiffMergeController
}

const DiffMergeOperationPane: React.FC<DiffMergeOperationPaneProps> = ({
  visible,
  selectedCount,
  queueCandidateIds,
  controller,
}) => {
  if (!visible) return null
  const hasQueueHunks = queueCandidateIds.length > 0
  return (
    <section data-block="operation-pane" data-testid="diff-merge-operation-pane" data-visible={selectedCount > 0 ? 'true' : 'false'}>
      <button
        type="button"
        data-testid="diff-merge-queue-selected"
        data-command="queue-merge"
        data-hunks={JSON.stringify(queueCandidateIds)}
        disabled={!hasQueueHunks}
        aria-disabled={hasQueueHunks ? 'false' : 'true'}
        onClick={() => {
          if (!hasQueueHunks) {
            return
          }
          void controller.queueMerge(queueCandidateIds)
        }}
      >
        Queue Selected
      </button>
    </section>
  )
}

interface DiffMergeEditModalProps {
  readonly editingHunkId: string | null
  readonly editingHunk: MergeHunk | undefined
  readonly controller: DiffMergeController
}

const DiffMergeEditModal: React.FC<DiffMergeEditModalProps> = ({ editingHunkId, editingHunk, controller }) => {
  if (!editingHunkId || !editingHunk) return null
  return (
    <section role="dialog" data-block="edit-modal" data-testid="diff-merge-edit-modal" data-hunk={editingHunkId}>
      <header>{editingHunk.section ?? editingHunk.id}</header>
      <button type="button" data-action="commit-edit" onClick={() => controller.commitEdit(editingHunkId)}>
        Commit
      </button>
      <button type="button" data-action="cancel-edit" onClick={() => controller.cancelEdit()}>
        Cancel
      </button>
    </section>
  )
}

export interface DiffMergeViewProps {
  readonly precision: MergePrecision
  readonly hunks: readonly MergeHunk[]
  readonly queueMergeCommand: QueueMergeCommand
  readonly autoApplied?: DiffMergeAutoAppliedState
  readonly disabled?: boolean
}
interface DiffMergeViewContentProps extends Omit<DiffMergeViewProps, 'disabled'> {}

const DiffMergeViewDisabled: React.FC<Pick<DiffMergeViewProps, 'precision'>> = ({ precision }) => (
  <section
    data-component="diff-merge-view"
    data-block="diff-merge-disabled"
    data-precision={precision}
    data-testid="diff-merge-disabled"
    aria-disabled="true"
  />
)

const DiffMergeViewContent: React.FC<DiffMergeViewContentProps> = ({
  precision,
  hunks,
  queueMergeCommand,
  autoApplied,
}) => {
  const plan = useMemo(() => planDiffMergeView(precision), [precision])
  const storage = (globalThis as { localStorage?: DiffMergeTabStorage }).localStorage
  const storedTabManager = useMemo(
    () => createDiffMergeStoredTabManager({ plan, precision, storage }),
    [plan, precision, storage],
  )
  const allowedTabKeys = storedTabManager.allowedTabs
  const resolvedInitialTab = useMemo(
    () => storedTabManager.resolveInitialTab(plan.initialTab),
    [storedTabManager, plan.initialTab],
  )
  const [activeTab, setActiveTab] = useState(resolvedInitialTab)

  useEffect(() => {
    setActiveTab(resolvedInitialTab)
  }, [resolvedInitialTab])

  const [state, dispatch] = useReducer(diffMergeReducer, hunks, createInitialDiffMergeState)
  const knownHunkIds = useMemo(() => hunks.map((hunk) => hunk.id), [hunks])
  const previousHunkIdsRef = useRef<readonly string[]>([])

  useEffect(() => {
    const previous = previousHunkIdsRef.current
    const next = knownHunkIds
    if (previous.length === next.length && previous.every((id, index) => id === next[index])) {
      return
    }
    const nextSet = new Set(next)
    const removed = previous.filter((id) => !nextSet.has(id))
    if (removed.length > 0) {
      dispatch({ type: 'resetMany', hunkIds: removed })
    }
    previousHunkIdsRef.current = next
    dispatch({ type: 'syncHunks', hunks })
  }, [dispatch, hunks, knownHunkIds])

  const getCurrentHunkIds = useCallback(() => knownHunkIds, [knownHunkIds])
  const controller = useMemo(() => {
    const instance = createDiffMergeController({
      precision,
      dispatch,
      queueMergeCommand,
      getCurrentHunkIds,
      resolveCurrentTab: () => activeTab,
      autoApplied,
    })
    if (isDevelopmentEnvironment()) {
      const hook = (globalThis as {
        __diffMergeViewOnControllerReady?: (controller: DiffMergeController) => void
      }).__diffMergeViewOnControllerReady
      hook?.(instance)
    }
    return instance
  }, [activeTab, precision, dispatch, queueMergeCommand, getCurrentHunkIds, autoApplied])
  const activeLayout = useMemo(() => plan.tabs.find((tab) => tab.key === activeTab) ?? plan.tabs[0]!, [plan, activeTab])
  const selectedHunkIds = useMemo(
    () =>
      Object.entries(state.hunkStates)
        .filter(([, status]) => status === 'Selected' || status === 'Editing')
        .map(([id]) => id),
    [state.hunkStates],
  )
  const queueCandidateIds = useMemo(
    () => retainKnownHunkIds(selectedHunkIds, knownHunkIds),
    [selectedHunkIds, knownHunkIds],
  )
  const queueCandidateCount = queueCandidateIds.length
  const editingHunkId = state.editingHunkId
  const editingHunk = editingHunkId ? hunks.find((hunk) => hunk.id === editingHunkId) : undefined

  const handleSelectTab = useCallback(
    (key: DiffMergeSubTabKey) => {
      if (!allowedTabKeys.has(key)) {
        return
      }
      setActiveTab(key)
      storedTabManager.persist(key)
    },
    [allowedTabKeys, setActiveTab, storedTabManager],
  )

  const planTabs = plan.tabs
  const planNavigationBadge = plan.navigationBadge
  const planTabKeys = useMemo(() => planTabs.map((tab) => tab.key), [planTabs])
  const handleNavigationKeyDown = useMemo(() => {
    const handler = createDiffMergeNavigationKeyHandler({
      tabs: planTabKeys,
      resolveActive: () => activeTab,
      onSelect: handleSelectTab,
    })
    return (event: React.KeyboardEvent<HTMLElement>) => {
      handler(event)
    }
  }, [activeTab, handleSelectTab, planTabKeys])
  const navigation = useMemo(
    () => (
      <DiffMergeNavigation
        precision={precision}
        navigationBadge={planNavigationBadge}
        tabs={planTabs}
        activeTab={activeTab}
        onSelect={handleSelectTab}
        onKeyDown={handleNavigationKeyDown}
      />
    ),
    [activeTab, handleNavigationKeyDown, handleSelectTab, planNavigationBadge, planTabs, precision],
  )

  const isHunkListVisible = activeLayout.panes.includes('hunk-list')
  const hunkList = useMemo(
    () => (
      <DiffMergeHunkList
        visible={isHunkListVisible}
        hunks={hunks}
        hunkStates={state.hunkStates}
        controller={controller}
      />
    ),
    [controller, hunks, isHunkListVisible, state.hunkStates],
  )

  const isOperationPaneVisible = activeLayout.panes.includes('operation-pane')
  const operationPane = useMemo(
    () => (
      <DiffMergeOperationPane
        visible={isOperationPaneVisible}
        selectedCount={queueCandidateCount}
        queueCandidateIds={queueCandidateIds}
        controller={controller}
      />
    ),
    [controller, isOperationPaneVisible, queueCandidateCount, queueCandidateIds],
  )

  const editModal = useMemo(
    () => (
      <DiffMergeEditModal
        editingHunkId={editingHunkId ?? null}
        editingHunk={editingHunk}
        controller={controller}
      />
    ),
    [controller, editingHunk, editingHunkId],
  )

  return (
    <section data-component="diff-merge-view" data-precision={precision} data-phase={plan.phase}>
      {navigation}
      {hunkList}
      {operationPane}
      {editModal}
    </section>
  )
}

export const DiffMergeView: React.FC<DiffMergeViewProps> = ({ disabled = false, ...props }) => {
  if (disabled) {
    return <DiffMergeViewDisabled precision={props.precision} />
  }
  return <DiffMergeViewContent {...props} />
}
