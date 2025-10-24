import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'

import { createDiffMergeController, createInitialDiffMergeState, diffMergeReducer, retainKnownHunkIds } from './diffMergeState.js'

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

export interface PrecisionPhaseGuard {
  readonly phase: 'phase-a' | 'phase-b'
  readonly allowedTabs: readonly DiffMergeSubTabKey[]
  readonly initialTab: DiffMergeSubTabKey
}

export const PRECISION_PHASE_GUARD: Record<MergePrecision, PrecisionPhaseGuard> = Object.freeze({
  legacy: { phase: 'phase-a', allowedTabs: ['review'], initialTab: 'review' },
  beta: { phase: 'phase-b', allowedTabs: ['review', 'merged', 'diff'], initialTab: 'review' },
  stable: { phase: 'phase-b', allowedTabs: ['diff', 'merged', 'review'], initialTab: 'diff' },
})

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

type DiffMergePaneKey = DiffMergePaneSpec['key']
export interface DiffMergeSubTabLayout{readonly key:DiffMergeSubTabKey;readonly label:string;readonly panes:readonly DiffMergePaneKey[];readonly badge?:'beta'}
export interface DiffMergeViewPlan{readonly precision:MergePrecision;readonly phase:PrecisionPhaseGuard['phase'];readonly tabs:readonly DiffMergeSubTabLayout[];readonly initialTab:DiffMergeSubTabKey;readonly navigationBadge?:'beta'}
const SUB_TAB_LAYOUTS:Record<DiffMergeSubTabKey,{readonly label:string;readonly panes:readonly DiffMergePaneKey[]}> = Object.freeze({diff:{label:SUB_TAB_LABELS.diff,panes:['hunk-list'] as const},merged:{label:SUB_TAB_LABELS.merged,panes:['operation-pane'] as const},review:{label:SUB_TAB_LABELS.review,panes:['hunk-list','operation-pane'] as const}})
const PRECISION_SUB_TAB_ORDER:Record<MergePrecision,readonly DiffMergeSubTabKey[]> = Object.freeze({legacy:['review'],beta:['review','diff','merged'],stable:['diff','merged','review']})
const buildDiffMergeViewPlan=(precision:MergePrecision):DiffMergeViewPlan=>{const guard=PRECISION_PHASE_GUARD[precision];const order=PRECISION_SUB_TAB_ORDER[precision];const navigationBadge=precision==='beta'?'beta':undefined;const tabs=order.map((key)=>{const layout=SUB_TAB_LAYOUTS[key];const panesForPrecision:readonly DiffMergePaneKey[]=precision==='legacy'&&key==='review'?(['hunk-list'] as const):layout.panes;const badge=precision==='beta'&&key==='diff'?('beta' as const):undefined;return{key,label:layout.label,panes:panesForPrecision,badge}});return{precision,phase:guard.phase,tabs,initialTab:guard.initialTab,navigationBadge}}
const DIFF_MERGE_VIEW_PLAN:Record<MergePrecision,DiffMergeViewPlan> = Object.freeze({legacy:buildDiffMergeViewPlan('legacy'),beta:buildDiffMergeViewPlan('beta'),stable:buildDiffMergeViewPlan('stable')})
export const planDiffMergeView=(precision:MergePrecision):DiffMergeViewPlan=>DIFF_MERGE_VIEW_PLAN[precision]
export const planDiffMergeSubTabs=(precision:MergePrecision):DiffMergeSubTabPlan=>{const plan=planDiffMergeView(precision);return{tabs:plan.tabs.map((tab)=>tab.key),initialTab:plan.initialTab,navigationBadge:plan.navigationBadge}}

const DIFF_MERGE_TAB_STORAGE_PREFIX='diff-merge.lastTab.' as const

export interface DiffMergeTabStorage{readonly getItem:(key:string)=>string|null;readonly setItem:(key:string,value:string)=>void;readonly removeItem?:(key:string)=>void}

export const resolveDiffMergeStoredTab=({plan,precision,storage,fallback}:{readonly plan:DiffMergeViewPlan;readonly precision:MergePrecision;readonly storage?:DiffMergeTabStorage;readonly fallback?:DiffMergeSubTabKey|null;}):DiffMergeSubTabKey=>{const storageKey=`${DIFF_MERGE_TAB_STORAGE_PREFIX}${precision}`;const stored=storage?.getItem(storageKey)??null;const isAllowed=(key:DiffMergeSubTabKey|null|undefined):key is DiffMergeSubTabKey=>!!key&&plan.tabs.some((tab)=>tab.key===key);if(stored&&!isAllowed(stored as DiffMergeSubTabKey))storage?.removeItem?.(storageKey);if(isAllowed(stored as DiffMergeSubTabKey|null))return stored as DiffMergeSubTabKey;if(isAllowed(fallback??null))return fallback as DiffMergeSubTabKey;return plan.initialTab}


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
  ] as const satisfies readonly DiffMergeTabSpec[],
  queueContract: {
    request: {
      type: 'queue-merge',
      precision: 'beta',
      origin: 'operation-pane.queue',
      hunkIds: [],
      telemetryContext: { collectorSurface: 'diff-merge.hunk-list', analyzerSurface: 'diff-merge.queue', lastTab: 'review' },
      metadata: { autoSaveRequested: false },
    } satisfies DiffMergeQueueCommandPayload,
    response: {
      status: 'success',
      hunkIds: [],
      telemetry: { collectorSurface: 'diff-merge.hunk-list', analyzerSurface: 'diff-merge.queue', retryable: false },
    } satisfies MergeDecisionEvent,
  },
  flowDiagrams,
  componentResponsibilities: diffMergeComponentResponsibilities,
})

export interface DiffMergeViewProps {
  readonly precision: MergePrecision
  readonly hunks: readonly MergeHunk[]
  readonly queueMergeCommand: QueueMergeCommand
}

export const DiffMergeView:React.FC<DiffMergeViewProps>=({precision,hunks,queueMergeCommand})=>{const plan=useMemo(()=>planDiffMergeView(precision),[precision]);const [activeTab,setActiveTab]=useState(plan.initialTab);useEffect(()=>{setActiveTab(plan.initialTab)},[plan.initialTab]);const [state,dispatch]=useReducer(diffMergeReducer,hunks,createInitialDiffMergeState);const knownHunkIds=useMemo(()=>hunks.map((hunk)=>hunk.id),[hunks]);const previousHunkIdsRef=useRef<readonly string[]>([]);useEffect(()=>{const previous=previousHunkIdsRef.current;const next=knownHunkIds;if(previous.length===next.length&&previous.every((id,index)=>id===next[index]))return;const nextSet=new Set(next);const removed=previous.filter((id)=>!nextSet.has(id));if(removed.length>0)dispatch({type:'resetMany',hunkIds:removed});previousHunkIdsRef.current=next;dispatch({type:'syncHunks',hunks})},[dispatch,hunks,knownHunkIds]);const getCurrentHunkIds=useCallback(()=>knownHunkIds,[knownHunkIds]);const controller=useMemo(()=>createDiffMergeController({precision,dispatch,queueMergeCommand,getCurrentHunkIds}),[precision,dispatch,queueMergeCommand,getCurrentHunkIds]);const activeLayout=useMemo(()=>plan.tabs.find((tab)=>tab.key===activeTab)??plan.tabs[0]!,[plan,activeTab]);const selectedHunkIds=useMemo(()=>Object.entries(state.hunkStates).filter(([,status])=>status==='Selected'||status==='Editing').map(([id])=>id),[state.hunkStates]);const queueCandidateIds=selectedHunkIds.length>0?selectedHunkIds:knownHunkIds;const queueHunkIds=useMemo(()=>retainKnownHunkIds(queueCandidateIds,knownHunkIds),[queueCandidateIds,knownHunkIds]);const queueHunksJson=JSON.stringify(queueHunkIds);const editingHunkId=state.editingHunkId;const editingHunk=editingHunkId?hunks.find((hunk)=>hunk.id===editingHunkId):undefined;const navChildren=plan.tabs.map((tab)=>React.createElement('button',{key:tab.key,type:'button',role:'tab','data-testid':`diff-merge-tab-${tab.key}`,'data-tab':tab.key,'aria-selected':tab.key===activeTab,onClick:()=>setActiveTab(tab.key)},tab.label,tab.badge?React.createElement('span',{'data-badge':tab.badge},tab.badge.toUpperCase()):null));const hunkChildren=hunks.map((hunk)=>{const status=state.hunkStates[hunk.id]??'Unreviewed';const isSelected=status==='Selected'||status==='Editing';return React.createElement('article',{key:hunk.id,'data-testid':`diff-merge-hunk-${hunk.id}`,'data-hunk':hunk.id,'data-status':status},React.createElement('header',null,hunk.section??hunk.id),React.createElement('div',null,React.createElement('button',{type:'button','data-testid':`diff-merge-hunk-${hunk.id}-toggle`,'data-hunk':hunk.id,'aria-pressed':isSelected,onClick:()=>controller.toggleSelect(hunk.id)},'Toggle'),React.createElement('button',{type:'button','data-testid':`diff-merge-hunk-${hunk.id}-edit`,onClick:()=>controller.openEditor(hunk.id)},'Edit')))});const hunkList=activeLayout.panes.includes('hunk-list')?React.createElement('section',{'data-testid':'diff-merge-hunk-list'},...hunkChildren):null;const operationPane=activeLayout.panes.includes('operation-pane')?React.createElement('section',{'data-testid':'diff-merge-operation-pane','data-visible':selectedHunkIds.length>0?'true':'false'},React.createElement('button',{type:'button','data-testid':'diff-merge-queue-selected','data-command':'queue-merge','data-hunks':queueHunksJson,onClick:()=>{void controller.queueMerge(queueHunkIds)}},'Queue Selected')):null;const editModal=editingHunkId&&editingHunk?React.createElement('section',{role:'dialog','data-testid':'diff-merge-edit-modal','data-hunk':editingHunkId},React.createElement('header',null,editingHunk.section??editingHunk.id),React.createElement('button',{type:'button','data-action':'commit-edit',onClick:()=>controller.commitEdit(editingHunkId)},'Commit'),React.createElement('button',{type:'button','data-action':'cancel-edit',onClick:()=>controller.cancelEdit()},'Cancel')):null;return React.createElement('section',{'data-component':'diff-merge-view','data-precision':precision,'data-phase':plan.phase},React.createElement('nav',{role:'tablist','data-precision':precision,'data-navigation-badge':plan.navigationBadge??undefined},...navChildren),hunkList,operationPane,editModal)}
