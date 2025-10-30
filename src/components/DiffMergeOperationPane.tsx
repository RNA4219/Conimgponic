import React from 'react'

export interface DiffMergeQueueController {
  readonly queueMerge: (hunkIds: readonly string[]) => Promise<void> | void
}

export interface DiffMergeOperationPaneProps {
  readonly visible: boolean
  readonly selectedCount: number
  readonly queueCandidateIds: readonly string[]
  readonly controller: DiffMergeQueueController
}

export const DiffMergeOperationPane: React.FC<DiffMergeOperationPaneProps> = ({
  visible,
  selectedCount,
  queueCandidateIds,
  controller,
}) => {
  if (!visible) return null
  const hasQueueHunks = queueCandidateIds.length > 0
  return (
    <section
      data-block="operation-pane"
      data-testid="diff-merge-operation-pane"
      data-visible={selectedCount > 0 ? 'true' : 'false'}
    >
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
