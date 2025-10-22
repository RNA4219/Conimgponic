import assert from 'node:assert/strict'
import test from 'node:test'
import {createDiffMergeController,createInitialDiffMergeState,diffMergeReducer,DiffMergeAction,DiffMergeState,MergeDecisionEvent} from '../../src/components/diffMergeState'
import type { MergePrecision } from '../../src/components/DiffMergeView'

type Dispatch=(action:DiffMergeAction)=>void
const harness=(precision:MergePrecision='stable')=>{let state:DiffMergeState=createInitialDiffMergeState([{id:'h1',title:'H1',original:'',incoming:'',status:'pending'} as any]);const dispatch:Dispatch=(action)=>{state=diffMergeReducer(state,action)};const controller=createDiffMergeController({precision,dispatch,queueMergeCommand:async()=>({status:'success',hunkIds:['h1']})});return{state:()=>state,dispatch,controller}}

test('toggleSelect',()=>{const h=harness();h.dispatch({type:'toggleSelect',hunkId:'h1'});assert.equal(h.state().hunkStates.h1,'Selected');h.dispatch({type:'toggleSelect',hunkId:'h1'});assert.equal(h.state().hunkStates.h1,'Unreviewed')})

test('markSkipped/reset',()=>{const h=harness();h.dispatch({type:'markSkipped',hunkId:'h1'});assert.equal(h.state().hunkStates.h1,'Skipped');h.dispatch({type:'reset',hunkId:'h1'});assert.equal(h.state().hunkStates.h1,'Unreviewed')})

test('queueMerge success',async()=>{const payloads:unknown[]=[];let state:DiffMergeState=createInitialDiffMergeState([{id:'h1',title:'H1',original:'',incoming:'',status:'pending'} as any]);const dispatch:Dispatch=(a)=>{state=diffMergeReducer(state,a)};const controller=createDiffMergeController({precision:'stable',dispatch,queueMergeCommand:async(p)=>{payloads.push(p);return{status:'success',hunkIds:['h1']} as MergeDecisionEvent}});await controller.queueMerge(['h1']);assert.equal(payloads.length,1);assert.equal(state.hunkStates.h1,'Merged')})

test('openEditor/commitEdit',()=>{const h=harness();h.controller.openEditor('h1');assert.equal(h.state().editingHunkId,'h1');assert.equal(h.state().hunkStates.h1,'Editing');h.controller.commitEdit('h1');assert.equal(h.state().editingHunkId,null);assert.equal(h.state().hunkStates.h1,'Selected')})
