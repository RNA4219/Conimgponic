import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDiffMergeController,
  createInitialDiffMergeState,
  diffMergeReducer,
  type DiffMergeAction,
  type DiffMergeState,
} from '../../src/components/diffMergeState'
import { planDiffMergeView } from '../../src/components/DiffMergeView'
import type {
  DiffMergeQueueCommandPayload,
  MergeDecisionEvent,
  MergeHunk,
  MergePrecision,
} from '../../src/components/DiffMergeView'

type Dispatch = (action: DiffMergeAction) => void

const createMergeHunk = (overrides?: Partial<MergeHunk>): MergeHunk => {
  const base: MergeHunk = {
    id: 'h1',
    section: null,
    decision: 'auto',
    similarity: 1,
    merged: '',
    manual: '',
    ai: '',
    base: '',
    prefer: 'none',
  }
  return { ...base, ...overrides }
}

const successEvent: MergeDecisionEvent = {
  status: 'success',
  hunkIds: ['h1'],
  telemetry: {
    collectorSurface: 'diff-merge.hunk-list',
    analyzerSurface: 'diff-merge.queue',
    retryable: false,
  },
}

const harness = (precision: MergePrecision = 'stable') => {
  let state: DiffMergeState = createInitialDiffMergeState([createMergeHunk()])
  const dispatch: Dispatch = (action) => {
    state = diffMergeReducer(state, action)
  }
  const controller = createDiffMergeController({
    precision,
    dispatch,
    queueMergeCommand: async () => successEvent,
  })
  return { state: () => state, dispatch, controller }
}

test('toggleSelect', () => {
  const h = harness()
  h.dispatch({ type: 'toggleSelect', hunkId: 'h1' })
  assert.equal(h.state().hunkStates.h1, 'Selected')
  h.dispatch({ type: 'toggleSelect', hunkId: 'h1' })
  assert.equal(h.state().hunkStates.h1, 'Unreviewed')
})

test('markSkipped/reset', () => {
  const h = harness()
  h.dispatch({ type: 'markSkipped', hunkId: 'h1' })
  assert.equal(h.state().hunkStates.h1, 'Skipped')
  h.dispatch({ type: 'reset', hunkId: 'h1' })
  assert.equal(h.state().hunkStates.h1, 'Unreviewed')
})

test('queueMerge success', async () => {
  const payloads: DiffMergeQueueCommandPayload[] = []
  let state: DiffMergeState = createInitialDiffMergeState([createMergeHunk()])
  const dispatch: Dispatch = (action) => {
    state = diffMergeReducer(state, action)
  }
  const controller = createDiffMergeController({
    precision: 'stable',
    dispatch,
    queueMergeCommand: async (payload) => {
      payloads.push(payload)
      return successEvent
    },
  })
  await controller.queueMerge(['h1'])
  assert.equal(payloads.length, 1)
  assert.equal(state.hunkStates.h1, 'Merged')
})

test('openEditor/commitEdit', () => {
  const h = harness()
  h.controller.openEditor('h1')
  assert.equal(h.state().editingHunkId, 'h1')
  assert.equal(h.state().hunkStates.h1, 'Editing')
  h.controller.commitEdit('h1')
  assert.equal(h.state().editingHunkId, null)
  assert.equal(h.state().hunkStates.h1, 'Selected')
})

test('planDiffMergeView legacy restricts panes to review hunk list', () => {
  const plan = planDiffMergeView('legacy')
  assert.deepEqual(
    plan.tabs.map((tab) => tab.key),
    ['review'],
  )
  assert.equal(plan.initialTab, 'review')
  assert.deepEqual(plan.tabs[0]?.panes, ['hunk-list'])
  assert.equal(plan.phase, 'phase-a')
})

test('planDiffMergeView stable exposes diff workflow panes', () => {
  const plan = planDiffMergeView('stable')
  assert.deepEqual(
    plan.tabs.map((tab) => tab.key),
    ['diff', 'merged', 'review'],
  )
  assert.equal(plan.initialTab, 'diff')
  const diffTab = plan.tabs[0]
  if (!diffTab) throw new Error('diff tab missing')
  assert.deepEqual(diffTab.panes, ['hunk-list'])
  const review = plan.tabs.find((tab) => tab.key === 'review')
  if (!review) throw new Error('review tab missing')
  assert.deepEqual(review.panes, ['hunk-list', 'operation-pane'])
  assert.equal(plan.navigationBadge, undefined)
  assert.equal(plan.phase, 'phase-b')
})
