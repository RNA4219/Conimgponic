import React, { useEffect, useMemo, useRef, useState } from 'react'

import type { FlagSnapshot } from '../config'
import { useSB } from '../store'
import { toMarkdown, toCSV, toJSONL, downloadText } from '../lib/exporters'
import { mergeCSV, mergeJSONL, readFileAsText, ImportMode } from '../lib/importers'
import { saveText, loadText, ensureDir } from '../lib/opfs'
import { sha256Hex } from '../lib/hash'
import { GoldenCompare } from './GoldenCompare'
import { planDiffMergeView } from './DiffMergeView'

type MergePrecision = FlagSnapshot['merge']['precision']

const BASE_TAB_IDS = ['compiled', 'shot', 'assets', 'import', 'golden'] as const
type BaseTabId = (typeof BASE_TAB_IDS)[number]
type MergeDockTabId = BaseTabId | 'diff'

type MergeDockTabPlanEntry = { readonly id: MergeDockTabId; readonly label: string; readonly badge?: 'Beta' }
type MergeDockDiffPlan = {
  readonly exposure: 'opt-in' | 'default'
  readonly backupAfterMs?: number
}

type MergeDockTabPlan = {
  readonly tabs: readonly MergeDockTabPlanEntry[]
  readonly initialTab: MergeDockTabId
  readonly diff?: MergeDockDiffPlan
}

type MergePhaseKey = 'phase-a' | 'phase-b'

export interface MergeThresholdPlan {
  readonly precision: MergePrecision
  readonly input: number | null
  readonly request: number
  readonly slider: { readonly min: number; readonly max: number; readonly step: number; readonly defaultValue: number }
  readonly autoTarget: number
  readonly reviewBand?: { readonly min: number; readonly max: number }
  readonly conflictBand?: { readonly max: number }
}

export interface MergeDockPhasePlan {
  readonly precision: MergePrecision
  readonly phase: MergePhaseKey
  readonly tabs: MergeDockTabPlan
  readonly diff: { readonly exposure: 'hidden' | 'opt-in' | 'default'; readonly enabled: boolean; readonly initialTab: MergeDockTabId }
  readonly threshold: MergeThresholdPlan
  readonly autoApplied: { readonly rate: number | null; readonly target: number; readonly meetsTarget: boolean | null }
  readonly guard: { readonly phaseBRequired: boolean; readonly reviewBandCount: number | null; readonly conflictBandCount: number | null }
}

export interface MergeDockPhaseStats {
  readonly reviewBandCount: number
  readonly conflictBandCount: number
}

export interface MergeDockPhaseInput {
  readonly precision: MergePrecision
  readonly threshold?: number | null
  readonly lastTab?: MergeDockTabId
  readonly autoAppliedRate?: number | null
  readonly phaseStats?: MergeDockPhaseStats | null
}

interface MergeThresholdRule {
  readonly phase: MergePhaseKey
  readonly diffExposure: 'hidden' | 'opt-in' | 'default'
  readonly clamp: { readonly min: number; readonly max: number | null }
  readonly autoOffset: number
  readonly reviewBand?: { readonly below: number; readonly above: number }
  readonly conflictBand?: { readonly below: number }
  readonly slider: { readonly min: number; readonly max: number }
}

const DIFF_BACKUP_THRESHOLD_MS = 5 * 60 * 1000

const DEFAULT_THRESHOLD = 0.72

const THRESHOLD_RULES: Record<MergePrecision, MergeThresholdRule> = Object.freeze({
  legacy: {
    phase: 'phase-a',
    diffExposure: 'hidden',
    clamp: { min: 0.65, max: null },
    autoOffset: 0.08,
    slider: { min: 0.65, max: 0.9 },
  },
  beta: {
    phase: 'phase-b',
    diffExposure: 'opt-in',
    clamp: { min: 0.68, max: 0.9 },
    autoOffset: 0.05,
    reviewBand: { below: 0.02, above: 0.05 },
    conflictBand: { below: 0.02 },
    slider: { min: 0.68, max: 0.9 },
  },
  stable: {
    phase: 'phase-b',
    diffExposure: 'default',
    clamp: { min: 0.7, max: 0.94 },
    autoOffset: 0.03,
    reviewBand: { below: 0.01, above: 0.03 },
    conflictBand: { below: 0.01 },
    slider: { min: 0.7, max: 0.94 },
  },
})

const BASE_TABS = Object.freeze([
  { id: 'compiled', label: 'Compiled Script' },
  { id: 'shot', label: 'Shotlist / Export' },
  { id: 'assets', label: 'Assets' },
  { id: 'import', label: 'Import' },
  { id: 'golden', label: 'Golden' },
] as const satisfies readonly MergeDockTabPlanEntry[])

const MERGE_DOCK_TAB_PLAN: Record<MergePrecision, MergeDockTabPlan> = Object.freeze({
  legacy: { tabs: BASE_TABS, initialTab: 'compiled' },
  beta: {
    tabs: [...BASE_TABS, { id: 'diff', label: 'Diff (Beta)', badge: 'Beta' }],
    initialTab: 'compiled',
    diff: { exposure: 'opt-in' },
  },
  stable: {
    tabs: [...BASE_TABS.slice(0, -1), { id: 'diff', label: 'Diff' }, BASE_TABS.at(-1)!],
    initialTab: 'diff',
    diff: { exposure: 'default', backupAfterMs: DIFF_BACKUP_THRESHOLD_MS },
  },
})

const isBaseTabId = (value: unknown): value is BaseTabId => typeof value === 'string' && (BASE_TAB_IDS as readonly string[]).includes(value)

export const planMergeDockTabs = (precision: MergePrecision, lastTab?: MergeDockTabId): MergeDockTabPlan => {
  const plan = MERGE_DOCK_TAB_PLAN[precision]
  const requested = lastTab && (lastTab === 'diff' || isBaseTabId(lastTab)) ? lastTab : undefined
  const sanitized = requested && plan.tabs.some((entry) => entry.id === requested) ? requested : undefined
  if (precision === 'stable') return { tabs: plan.tabs, initialTab: sanitized ?? plan.initialTab }
  if (precision === 'legacy') return { tabs: plan.tabs, initialTab: sanitized && sanitized !== 'diff' ? sanitized : plan.initialTab }
  return { tabs: plan.tabs, initialTab: sanitized ?? plan.initialTab }
}

const clampValue = (value: number, min: number, max: number | null): number => {
  const upper = typeof max === 'number' ? max : 1
  return Math.min(Math.max(value, min), upper)
}

const roundRate = (value: number): number => Math.min(1, Math.max(0, Math.round(value * 100) / 100))

export const resolveMergeThresholdPlan = (precision: MergePrecision, threshold: number | null | undefined): MergeThresholdPlan => {
  const rule = THRESHOLD_RULES[precision]
  const validInput = typeof threshold === 'number' && Number.isFinite(threshold) ? threshold : null
  const base = validInput ?? DEFAULT_THRESHOLD
  const clamped = clampValue(base, rule.clamp.min, rule.clamp.max)
  const request = roundRate(clamped)
  const autoTarget = roundRate(clamped + rule.autoOffset)
  const reviewBand = rule.reviewBand
    ? {
        min: roundRate(clamped - rule.reviewBand.below),
        max: roundRate(clamped + rule.reviewBand.above),
      }
    : undefined
  const conflictBand = rule.conflictBand
    ? { max: roundRate(clamped - rule.conflictBand.below) }
    : undefined

  return {
    precision,
    input: validInput,
    request,
    slider: { min: rule.slider.min, max: rule.slider.max, step: 0.01, defaultValue: request },
    autoTarget,
    reviewBand,
    conflictBand,
  }
}

export const resolveMergeDockPhasePlan = ({
  precision,
  threshold,
  lastTab,
  autoAppliedRate,
  phaseStats,
}: MergeDockPhaseInput): MergeDockPhasePlan => {
  const rule = THRESHOLD_RULES[precision]
  const thresholdPlan = resolveMergeThresholdPlan(precision, threshold)
  const rawPlan = planMergeDockTabs(precision, lastTab)
  const statsProvided = !!phaseStats
  const reviewBandCount = statsProvided ? Math.max(0, phaseStats.reviewBandCount) : null
  const conflictBandCount = statsProvided ? Math.max(0, phaseStats.conflictBandCount) : null
  const phaseBRequired =
    precision === 'legacy'
      ? false
      : statsProvided
        ? precision === 'beta'
          ? (reviewBandCount ?? 0) > 0
          : ((reviewBandCount ?? 0) + (conflictBandCount ?? 0)) > 0
        : true
  const diffEnabled = !!rawPlan.diff && phaseBRequired
  const effectiveTabs = diffEnabled ? rawPlan.tabs : rawPlan.tabs.filter((entry) => entry.id !== 'diff')
  const effectiveInitial = diffEnabled || rawPlan.initialTab !== 'diff' ? rawPlan.initialTab : effectiveTabs[0]?.id ?? rawPlan.initialTab
  const sanitizedInitial = effectiveInitial && (effectiveTabs.some((entry) => entry.id === effectiveInitial) ? effectiveInitial : effectiveTabs[0]?.id ?? rawPlan.initialTab)
  const normalizedRate = typeof autoAppliedRate === 'number' && Number.isFinite(autoAppliedRate) ? autoAppliedRate : null
  const meetsTarget = normalizedRate == null ? null : normalizedRate >= thresholdPlan.autoTarget

  return {
    precision,
    phase: rule.phase,
    tabs: { tabs: effectiveTabs, initialTab: sanitizedInitial, diff: diffEnabled ? rawPlan.diff : undefined },
    diff: { exposure: rawPlan.diff?.exposure ?? 'hidden', enabled: diffEnabled, initialTab: rawPlan.initialTab },
    threshold: thresholdPlan,
    autoApplied: { rate: normalizedRate, target: thresholdPlan.autoTarget, meetsTarget },
    guard: { phaseBRequired, reviewBandCount, conflictBandCount },
  }
}

export interface DiffBackupPolicy {
  readonly enabledPrecisions: readonly MergePrecision[]
  readonly gateTab: MergeDockTabId
  readonly thresholdMs: number
}

export const diffBackupPolicy: DiffBackupPolicy = Object.freeze({
  enabledPrecisions: ['beta', 'stable'],
  gateTab: 'diff',
  thresholdMs: DIFF_BACKUP_THRESHOLD_MS,
})

export const shouldShowDiffBackupCTA = (
  policy: DiffBackupPolicy,
  precision: MergePrecision,
  tab: MergeDockTabId,
  lastSuccessAt: string | undefined,
  now: number,
): boolean => {
  if (!policy.enabledPrecisions.includes(precision) || tab !== policy.gateTab || !lastSuccessAt) return false
  const ts = Date.parse(lastSuccessAt)
  return Number.isFinite(ts) && now - ts > policy.thresholdMs
}

function Checks(){
  const { sb } = useSB()
  const warns: string[] = []
  sb.scenes.forEach((s, i)=>{
    if (!(s.manual||s.ai)) warns.push(`#${i+1} text empty`)
    if (!s.tone) warns.push(`#${i+1} tone missing`)
  })
  return (
    <div style={{padding:'6px 10px', color: warns.length? '#b45309':'#15803d'}}>
      {warns.length? `Warnings: ${warns.length}` : 'OK: No issues found'}
      {warns.length? <ul>{warns.map((w,i)=><li key={i}>{w}</li>)}</ul> : null}
    </div>
  )
}

interface MergeDockProps {
  readonly flags?: Pick<FlagSnapshot, 'merge'>
  readonly mergeThreshold?: number | null
  readonly autoAppliedRate?: number | null
  readonly phaseStats?: MergeDockPhaseStats | null
}

export function MergeDock(props?: MergeDockProps){
  const { sb } = useSB()
  const flags = props?.flags
  const mergeThreshold = props?.mergeThreshold ?? null
  const autoAppliedRate = props?.autoAppliedRate ?? null
  const phaseStats = props?.phaseStats ?? null
  const storage = typeof window !== 'undefined' ? window.localStorage : undefined
  const autoSaveInterop = typeof window !== 'undefined' ? (window as typeof window & { __mergeDockAutoSaveSnapshot?: { lastSuccessAt?: string }; __mergeDockFlushNow?: () => void }) : undefined
  const flagPrecision = flags?.merge.precision
  const precision = useMemo<MergePrecision>(()=>{
    if (flagPrecision) return flagPrecision
    const candidates = [(import.meta as any)?.env?.VITE_MERGE_PRECISION, storage?.getItem('merge.precision'), storage?.getItem('flag:merge.precision')]
    for (const value of candidates){ if (typeof value === 'string'){ const lower = value.toLowerCase(); if (lower==='legacy'||lower==='beta'||lower==='stable') return lower as MergePrecision } }
    return 'legacy'
  }, [flagPrecision, storage])
  const thresholdSetting = useMemo(()=>{
    if (typeof mergeThreshold === 'number' && Number.isFinite(mergeThreshold)) return mergeThreshold
    const storedThreshold = storage?.getItem('conimg.merge.threshold')
    if (typeof storedThreshold === 'string'){
      const parsed = Number(storedThreshold)
      if (Number.isFinite(parsed)) return parsed
    }
    return undefined
  }, [mergeThreshold, storage])
  const storedTabKey = storage?.getItem('merge.lastTab')
  const lastTab = storedTabKey && (storedTabKey === 'diff' || isBaseTabId(storedTabKey)) ? (storedTabKey as MergeDockTabId) : undefined
  const phasePlan = useMemo(
    () =>
      resolveMergeDockPhasePlan({
        precision,
        threshold: thresholdSetting,
        lastTab,
        autoAppliedRate,
        phaseStats,
      }),
    [
      precision,
      thresholdSetting,
      lastTab,
      autoAppliedRate,
      phaseStats?.reviewBandCount ?? null,
      phaseStats?.conflictBandCount ?? null,
    ],
  )
  const plan = phasePlan.tabs
  const [tab, setTabState] = useState<MergeDockTabId>(plan.initialTab)
  const [pref, setPref] = useState<'manual-first'|'ai-first'|'diff-merge'>(()=> precision==='stable' && phasePlan.diff.enabled ? 'diff-merge' : 'manual-first')
  const precisionRef = useRef(precision)
  useEffect(()=>{
    if (precisionRef.current !== precision){
      precisionRef.current = precision
      setTabState(plan.initialTab)
      storage?.setItem('merge.lastTab', plan.initialTab)
      return
    }
    if (!plan.tabs.some(entry=>entry.id===tab) || (tab==='diff' && !phasePlan.diff.enabled)){
      setTabState(plan.initialTab)
      storage?.setItem('merge.lastTab', plan.initialTab)
    }
  }, [phasePlan.diff.enabled, plan, precision, storage, tab])
  useEffect(()=>{
    if ((precision !== 'stable' || !phasePlan.diff.enabled) && pref === 'diff-merge'){ setPref('manual-first') }
  }, [phasePlan.diff.enabled, precision, pref])
  const setTab = (next: MergeDockTabId)=>{ setTabState(next); storage?.setItem('merge.lastTab', next) }
  const flushNow = autoSaveInterop?.__mergeDockFlushNow
  const showBackupCTA = (()=>{ if (!flushNow) return false; const last = autoSaveInterop?.__mergeDockAutoSaveSnapshot?.lastSuccessAt; return shouldShowDiffBackupCTA(diffBackupPolicy, precision, tab, last, Date.now()) })()

  const compiled = useMemo(()=>{
    const lines:string[] = []
    for (let i=0;i<sb.scenes.length;i++){
      const s = sb.scenes[i]
      const pick = s.lock ? (s.lock==='manual'? s.manual: s.ai) :
                   (pref==='manual-first' ? (s.manual || s.ai) :
                    pref==='ai-first' ? (s.ai || s.manual) : (s.manual || s.ai))
      lines.push(`## Cut ${i+1}\n${pick}`)
    }
    return lines.join("\n\n")
  }, [sb, pref])

  async function onImport(file: File, mode: ImportMode){
    const text = await readFileAsText(file)
    if (file.name.endsWith('.jsonl')){
      mergeJSONL(sb, text, mode)
    }else if (file.name.endsWith('.csv')){
      mergeCSV(sb, text, mode)
    }else if (file.name.endsWith('.md')){
      const blocks = text.split(/\n##\s*Cut\s+\d+/).slice(1)
      blocks.forEach((b, i)=>{
        const body = b.replace(/<!--.*?-->/g,'').trim()
        if (sb.scenes[i]){
          (sb.scenes[i] as any)[mode] = body
        }
      })
    }else{
      alert('Unsupported file type. Use .jsonl / .csv / .md')
      return
    }
    alert('Imported (merged).')
  }

  return (
    <div>
      <div className="tabs">
        {plan.tabs.map(entry=>(
          <button
            key={entry.id}
            className={"tab "+(tab===entry.id?'active':'')}
            onClick={()=>setTab(entry.id)}
          >
            {entry.label}
            {entry.badge ? <span style={{marginLeft:4, fontSize:'0.75em', color:'#2563eb'}}>{entry.badge}</span> : null}
          </button>
        ))}
        <div style={{marginLeft:'auto'}}><Checks/></div>
      </div>

      {tab==='diff' && <div style={{padding:8, display:'grid', gap:8}}>
        {showBackupCTA && <button className="btn" onClick={()=>flushNow?.()}>バックアップを今すぐ実行</button>}
        <p style={{margin:'4px 0'}}>Diff Merge ビューは準備中です。</p>
      </div>}

      {tab==='compiled' && (
        <div>
          <div style={{display:'flex', gap:8, padding:8, alignItems:'center'}}>
            <label>統合ルール:</label>
            <select value={pref} onChange={e=>setPref(e.target.value as any)}>
              <option value="manual-first">Manual優先</option>
              <option value="ai-first">AI優先</option>
              <option value="diff-merge">差分マージ（暫定）</option>
            </select>
          </div>
          <pre>{compiled}</pre>
        </div>
      )}

      {tab==='shot' && (
        <div style={{padding:8, display:'grid', gap:8}}>
          <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
            <button className="btn" onClick={()=>downloadText('shotlist.md', toMarkdown(sb))}>Export MD</button>
            <button className="btn" onClick={()=>downloadText('shotlist.csv', toCSV(sb))}>Export CSV</button>
            <button className="btn" onClick={()=>downloadText('shotlist.jsonl', toJSONL(sb))}>Export JSONL</button>
            <button className="btn" onClick={async()=>{
              const ts = new Date().toISOString().replace(/[:.]/g,'-')
              const dir = `runs/${ts}`
              await ensureDir(dir)
              const md = toMarkdown(sb)
              const csv = toCSV(sb)
              const jsonl = toJSONL(sb)
              const h = await sha256Hex(md + '\n' + csv + '\n' + jsonl)
              await saveText(`${dir}/shotlist.md`, md)
              await saveText(`${dir}/shotlist.csv`, csv)
              await saveText(`${dir}/shotlist.jsonl`, jsonl)
              await saveText(`${dir}/meta.json`, JSON.stringify({ hash: h, title: sb.title }, null, 2))
              await saveText('runs/latest.txt', ts)
              alert(`Saved snapshot to OPFS: ${dir}`)
            }}>Save Snapshot (OPFS)</button>
            <button className="btn" onClick={async()=>{
              const latest = await loadText('runs/latest.txt')
              if (!latest){ alert('No snapshot'); return }
              const md = await loadText(`runs/${latest}/shotlist.md`)
              if (md==null){ alert('Missing compiled MD'); return }
              const pre = document.querySelector('pre')
              if (pre) pre.textContent = md
              alert('Restored last compiled MD into preview (not scenes).')
            }}>Restore Last Compiled</button>
          </div>
          <pre>{toCSV(sb)}</pre>
        </div>
      )}

      {tab==='assets' && (
        <div style={{padding:8}}>
          <p style={{margin:'4px 0'}}>登場人物/小道具/背景のカタログ（OPFS保存対応）。</p>
        </div>
      )}

      {tab==='golden' && (
        <GoldenCompare />
      )}

      {tab==='import' && (
        <div style={{padding:8, display:'grid', gap:8}}>
          <div>
            <label>Import JSONL/CSV/MD → 反映先: </label>
            <select id="importMode">
              <option value="manual">manual</option>
              <option value="ai">ai</option>
            </select>
          </div>
          <input type="file" onChange={async e=>{
            const f = e.target.files?.[0]; if (!f) return
            const mode = (document.getElementById('importMode') as HTMLSelectElement).value as any
            await onImport(f, mode)
          }}/>
        </div>
      )}
    </div>
  )
}
