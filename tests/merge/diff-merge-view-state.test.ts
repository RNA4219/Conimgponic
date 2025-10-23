import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {createDiffMergeController,createInitialDiffMergeState,diffMergeReducer,DiffMergeAction,DiffMergeState,MergeDecisionEvent} from '../../src/components/diffMergeState'
import { DiffMergeView, planDiffMergeView, resolveDiffMergeStoredTab } from '../../src/components/DiffMergeView'
import type {
  DiffMergeTabStorage,
  DiffMergeSubTabKey,
  MergeHunk,
  MergePrecision,
  QueueMergeCommand,
} from '../../src/components/DiffMergeView'

type DiffMergeQueueCommandPayload = Parameters<QueueMergeCommand>[0]

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

test('queueMerge telemetry captures active diff tab', async () => {
  const captured: DiffMergeQueueCommandPayload[] = []
  let tab: DiffMergeSubTabKey = 'review'
  const controller = createDiffMergeController({
    precision: 'stable',
    dispatch: () => undefined,
    queueMergeCommand: async (payload) => {
      captured.push(payload)
      return successEvent
    },
    resolveLastTab: () => tab,
  })
  tab = 'merged'
  await controller.queueMerge(['h1'])
  assert.equal(captured.length, 1)
  assert.equal(captured[0]?.telemetryContext.lastTab, 'merged')
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

test('planDiffMergeView stable exposes diff workflow panes',()=>{const plan=planDiffMergeView('stable');assert.deepEqual(plan.tabs.map((tab)=>tab.key),['diff','merged','review']);assert.equal(plan.initialTab,'diff');const diffTab=plan.tabs[0];if(!diffTab)throw new Error('diff tab missing');assert.deepEqual(diffTab.panes,['hunk-list']);const review=plan.tabs.find((tab)=>tab.key==='review');if(!review)throw new Error('review tab missing');assert.deepEqual(review.panes,['hunk-list','operation-pane']);assert.equal(plan.navigationBadge,undefined);assert.equal(plan.phase,'phase-b')})

test('planDiffMergeView beta orders review, diff, merged with beta badges',()=>{const plan=planDiffMergeView('beta');assert.deepEqual(plan.tabs.map((tab)=>tab.key),['review','diff','merged']);assert.equal(plan.initialTab,'review');assert.equal(plan.navigationBadge,'beta');const diffTab=plan.tabs.find((tab)=>tab.key==='diff');if(!diffTab)throw new Error('diff tab missing');assert.equal(diffTab.badge,'beta');assert.deepEqual(diffTab.panes,['hunk-list']);const mergedTab=plan.tabs.find((tab)=>tab.key==='merged');if(!mergedTab)throw new Error('merged tab missing');assert.deepEqual(mergedTab.panes,['operation-pane'])})

const sampleHunks:readonly MergeHunk[]=[{id:'h1',section:'scene-001',decision:'conflict',similarity:0.5,merged:'<merged />',manual:'<manual />',ai:'<ai />',base:'<base />',prefer:'none'}]
const renderView=(precision:MergePrecision)=>renderToStaticMarkup(createElement(DiffMergeView,{precision,hunks:sampleHunks,queueMergeCommand:async()=>({status:'success',hunkIds:[],telemetry:{collectorSurface:'diff-merge.hunk-list',analyzerSurface:'diff-merge.queue',retryable:false}})}))

test('DiffMergeView initial tab follows plan for beta/stable precisions',()=>{const betaHtml=renderView('beta');assert.match(betaHtml,/data-testid="diff-merge-tab-review"[^>]*aria-selected="true"/);assert.match(betaHtml,/data-navigation-badge="beta"/);const stableHtml=renderView('stable');assert.match(stableHtml,/data-testid="diff-merge-tab-diff"[^>]*aria-selected="true"/);assert.doesNotMatch(stableHtml,/data-navigation-badge=/)})

class MemoryStorage implements DiffMergeTabStorage {
  #map = new Map<string, string>()

  getItem(key: string): string | null {
    return this.#map.has(key) ? this.#map.get(key)! : null
  }

  setItem(key: string, value: string): void {
    this.#map.set(key, value)
  }

  removeItem(key: string): void {
    this.#map.delete(key)
  }
}

test('resolveDiffMergeStoredTab restores stable precision selection across mounts', () => {
  const storage = new MemoryStorage()
  storage.setItem('diff-merge.lastTab.stable', 'merged')
  const plan = planDiffMergeView('stable')
  assert.equal(
    resolveDiffMergeStoredTab({ plan, precision: 'stable', storage }),
    'merged',
  )
})
