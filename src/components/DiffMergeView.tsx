import React from 'react'

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
  readonly activeTab: DiffMergeTabKey
  readonly onTabChange: (tab: DiffMergeTabKey) => void
  readonly selection: string | null
  readonly onSelectionChange: (hunkId: string) => void
  readonly queueMergeCommand: (command: MergeCommand) => Promise<MergeCommandResult>
  readonly onError?: (error: MergeCommandResult & { readonly hunkId: string }) => void
}

/**
 * DiffMergeView は docs/design/diff-merge-view.md に定義された責務分割と
 * precision フラグの露出条件に従うコンテナコンポーネントのスケルトンです。
 * 実装は TDD シナリオ（同ドキュメント §9）に基づき段階的に追加してください。
 */
export const DiffMergeView: React.FC<DiffMergeViewProps> = () => {
  return null
}
