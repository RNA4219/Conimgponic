import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { FlagSnapshot } from '../config'
import { useSB } from '../store'
import { toMarkdown, toCSV, toJSONL, downloadText } from '../lib/exporters'
import { mergeCSV, mergeJSONL, readFileAsText, ImportMode } from '../lib/importers'
import type { Storyboard } from '../types'
import { isBaseTabId } from '../lib/merge/phasePlan'
import {
  getDefaultPreference,
  persistMergeDockActiveTab,
  resolveActiveTabTransition,
  resolvePreferenceSelection,
  sanitizeMergeDockActiveTab,
  sanitizePreference,
} from '../lib/merge/mergeDockPreference'
import { useMergeThreshold } from '../lib/merge/threshold'
import {
  computeStoryboardWarnings,
  diffBackupPolicy,
  diffMergeNoopCommand,
  emptyDiffHunks,
  mergeMarkdownStoryboard,
  readAutoSaveState,
  resolveMergeDockPhasePlan,
  shouldEnableDiffInteraction,
  shouldRenderDiffBackupCTA,
  startMergeDockAutoSaveHeartbeat,
  type MergeDockPhaseStats,
  type MergeDockPreference,
  type MergeDockTabId,
  type WorkspaceConfiguration,
} from './merge-dock/domain'
import {
  type MergeDockAutoSaveHeartbeatOptions,
  type MergeDockAutoSaveHeartbeatState,
  type MergeDockAutoSaveState,
  type MergeDockNotice,
  type MergeDockWindow,
} from './merge-dock/model'
import {
  createMergeDockViewStore,
  useMergeDockViewStore,
  type MergeDockViewStore,
} from './merge-dock/store'
import {
  loadLatestCompiledSnapshot,
  MergeDockSnapshotError,
  saveStoryboardSnapshot,
} from './merge-dock/io'

export {
  diffBackupPolicy,
  planMergeDockTabs,
  resolveMergeDockPhasePlan,
  resolveMergeThresholdPlan,
  shouldShowDiffBackupCTA,
  isDiffBackupCTAEligible,
  shouldEnableDiffInteraction,
  shouldRenderDiffBackupCTA,
  mergeMarkdownStoryboard,
  startMergeDockAutoSaveHeartbeat,
} from './merge-dock/domain'
import { GoldenCompare } from './GoldenCompare'
import { DiffMergeView } from './DiffMergeView'
import type { MergeHunk, QueueMergeCommand } from './diffMergeTypes.js'


const computeStoryboardWarnings = (storyboard: Storyboard): string[] => {
  const results: string[] = []
  for (let index = 0; index < storyboard.scenes.length; index += 1) {
    const scene = storyboard.scenes[index]!
    if (!(scene.manual || scene.ai)) {
      results.push(`#${index + 1} text empty`)
    }
    if (!scene.tone) {
      results.push(`#${index + 1} tone missing`)
    }
  }
  return results
}

function Checks(): JSX.Element {
  const warnings = useSB((state) => computeStoryboardWarnings(state.sb))
  const snapshot = Reflect.get(globalThis, '__conimgponic_sb_snapshot__') as Storyboard | undefined
  const effectiveWarnings = snapshot ? computeStoryboardWarnings(snapshot) : warnings
  const hasWarnings = effectiveWarnings.length > 0

  return (
    <div
      style={{ padding: '6px 10px', color: hasWarnings ? '#b45309' : '#15803d' }}
      data-warning-count={effectiveWarnings.length}
    >
      {hasWarnings ? `Warnings: ${effectiveWarnings.length}` : 'OK: No issues found'}
      {hasWarnings ? (
        <ul>
          {effectiveWarnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

interface MergeDockProps {
  readonly flags: Pick<FlagSnapshot, 'merge'>
  readonly mergeThreshold?: number | null
  readonly autoAppliedRate?: number | null
  readonly phaseStats?: MergeDockPhaseStats | null
  readonly workspace?: WorkspaceConfiguration | null
}

export function MergeDock({
  flags,
  mergeThreshold = null,
  autoAppliedRate = null,
  phaseStats = null,
  workspace = null,
}: MergeDockProps){
  const sb = useSB((state) => state.sb)
  const storage = typeof window !== 'undefined' ? window.localStorage : undefined
  const mergeWindow = typeof window !== 'undefined' ? (window as MergeDockWindow) : undefined
  const [autoSave, setAutoSave] = useState<MergeDockAutoSaveState>(() => readAutoSaveState(mergeWindow))
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const stop = startMergeDockAutoSaveHeartbeat(mergeWindow, ({ autoSave: nextAutoSave, now: nextNow }) => {
      setNow(nextNow)
      setAutoSave((previous) => {
        if (
          previous.flushNow === nextAutoSave.flushNow &&
          previous.lastSuccessAt === nextAutoSave.lastSuccessAt
        ) {
          return previous
        }
        return nextAutoSave
      })
    })
    return () => {
      stop()
    }
  }, [mergeWindow])
  const { precision, threshold } = useMergeThreshold({
    flags,
    threshold: mergeThreshold,
    workspace,
  })
  let storedTabKey: string | null | undefined
  if (storage) {
    try {
      storedTabKey = storage.getItem('merge.lastTab')
    } catch (error) {
      console.warn(
        'MergeDock: failed to read stored active tab. Falling back without localStorage.',
        'merge.lastTab',
        error,
      )
    }
  }
  const lastTab = storedTabKey && (storedTabKey === 'diff' || isBaseTabId(storedTabKey)) ? (storedTabKey as MergeDockTabId) : undefined
  const phasePlan = useMemo(
    () =>
      resolveMergeDockPhasePlan({
        precision,
        threshold,
        lastTab,
        autoAppliedRate,
        phaseStats,
      }),
    [
      precision,
      threshold,
      lastTab,
      autoAppliedRate,
      phaseStats?.reviewBandCount ?? null,
      phaseStats?.conflictBandCount ?? null,
    ],
  )
  const plan = phasePlan.tabs
  const diffPlan = phasePlan.diff
  const defaultPreference = sanitizePreference(
    getDefaultPreference(precision, phasePlan.diff.enabled),
    precision,
    phasePlan.diff.enabled,
  )
  const storeRef = useRef<MergeDockViewStore>()
  if (!storeRef.current) {
    storeRef.current = createMergeDockViewStore(plan.initialTab, defaultPreference)
  }
  const store = storeRef.current
  const activeTab = useMergeDockViewStore(store, (state) => state.activeTab)
  const preference = useMergeDockViewStore(store, (state) => state.preference)
  const previousPrecisionRef = useRef(precision)
  const previousDiffEnabledRef = useRef(phasePlan.diff.enabled)
  useEffect(() => {
    const previousPrecision = previousPrecisionRef.current
    const previousDiffEnabled = previousDiffEnabledRef.current
    const nextTab = resolveActiveTabTransition({
      precision,
      previousPrecision,
      plan,
      activeTab,
      diffVisible: phasePlan.diff.visible,
      diffEnabled: phasePlan.diff.enabled,
      previousDiffEnabled,
    })
    const nextPreference = resolvePreferenceSelection({
      precision,
      previousPrecision,
      diffEnabled: phasePlan.diff.enabled,
      previousDiffEnabled,
      preference,
      defaultPreference,
    })
    previousPrecisionRef.current = precision
    previousDiffEnabledRef.current = phasePlan.diff.enabled
    if (nextTab !== activeTab || nextPreference !== preference) {
      store.setState({
        ...(nextTab !== activeTab ? { activeTab: nextTab } : {}),
        ...(nextPreference !== preference ? { preference: nextPreference } : {}),
      })
    }
  }, [
    activeTab,
    plan,
    phasePlan.diff.visible,
    phasePlan.diff.enabled,
    precision,
    preference,
    defaultPreference,
    store,
  ])
  useEffect(() => {
    if (!storage) return
    persistMergeDockActiveTab({
      storage,
      storageKey: 'merge.lastTab',
      tab: activeTab,
    })
  }, [activeTab, storage])

  const [compiledOverride, setCompiledOverride] = useState<string | null>(null)
  const [notice, setNotice] = useState<MergeDockNotice | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('manual')
  const notify = useCallback((level: MergeDockNotice['level'], message: string) => {
    setNotice({ level, message })
  }, [])

  const onTabChange = useCallback(
    (next: MergeDockTabId) => {
      const sanitized = sanitizeMergeDockActiveTab(
        next,
        plan,
        phasePlan.diff.visible,
        phasePlan.diff.enabled,
      )
      store.getState().setActiveTab(sanitized)
    },
    [phasePlan.diff.visible, plan, store],
  )

  const onPreferenceChange = useCallback(
    (next: MergeDockPreference) => {
      const sanitized = sanitizePreference(next, precision, phasePlan.diff.enabled)
      store.getState().setPreference(sanitized)
    },
    [phasePlan.diff.enabled, precision, store],
  )

  useEffect(() => {
    setCompiledOverride(null)
  }, [preference])

  const compiled = useMemo(() => {
    const lines: string[] = []
    for (let i = 0; i < sb.scenes.length; i++) {
      const s = sb.scenes[i]
      const pick = s.lock
        ? s.lock === 'manual'
          ? s.manual
          : s.ai
        : preference === 'manual-first'
          ? s.manual || s.ai
          : preference === 'ai-first'
            ? s.ai || s.manual
            : s.manual || s.ai
      lines.push(`## Cut ${i + 1}\n${pick}`)
    }
    return lines.join('\n\n')
  }, [sb, preference])
  const compiledDisplay = compiledOverride ?? compiled

  const diffInteractionEnabled = shouldEnableDiffInteraction({
    diffPlan,
    guard: phasePlan.guard,
  })
  const showBackupCTA = shouldRenderDiffBackupCTA({
    diffPlan,
    tabPlan: plan,
    policy: diffBackupPolicy,
    precision,
    activeTab,
    autoSave,
    now,
  })

  const onImport = useCallback(
    async (file: File, mode: ImportMode) => {
      try {
        const text = await readFileAsText(file)
        const current = useSB.getState().sb
        let next: Storyboard | null = null
        if (file.name.endsWith('.jsonl')) {
          next = mergeJSONL(current, text, mode)
        } else if (file.name.endsWith('.csv')) {
          next = mergeCSV(current, text, mode)
        } else if (file.name.endsWith('.md')) {
          next = mergeMarkdownStoryboard(current, text, mode)
        } else {
          notify('error', 'Unsupported file type. Use .jsonl / .csv / .md')
          return
        }
        if (!next) {
          return
        }
        useSB.setState({ sb: next })
        notify('info', 'Imported storyboard updates.')
      } catch (error) {
        console.error(error)
        notify('error', 'Import failed. See console for details.')
      }
    },
    [notify],
  )

  return (
    <div
      data-merge-phase={phasePlan.phase}
      data-merge-diff-visible={diffPlan.visible ? 'true' : 'false'}
      data-merge-diff-enabled={diffPlan.enabled ? 'true' : 'false'}
      data-merge-diff-exposure={diffPlan.exposure}
      data-merge-diff-initial-tab={diffPlan.initialTab}
    >
      <div className="tabs">
        {plan.tabs.map((entry) => (
          <button
            key={entry.id}
            className={"tab " + (activeTab === entry.id ? 'active' : '')}
            type="button"
            onClick={() => onTabChange(entry.id)}
          >
            {entry.label}
            {entry.badge ? <span style={{ marginLeft: 4, fontSize: '0.75em', color: '#2563eb' }}>{entry.badge}</span> : null}
          </button>
        ))}
        <div style={{ marginLeft: 'auto' }}><Checks/></div>
      </div>

      {notice ? (
        <div
          role="status"
          data-testid="merge-dock-notice"
          data-level={notice.level}
          style={{ margin: '8px', padding: '8px', borderRadius: 4, background: notice.level === 'error' ? '#fee2e2' : '#e0f2fe', color: '#111827' }}
        >
          {notice.message}
        </div>
      ) : null}

      {activeTab === 'diff' && (
        <div
          style={{ padding: 8, display: 'grid', gap: 8 }}
          data-merge-diff-visible={diffPlan.visible ? 'true' : 'false'}
          data-merge-diff-enabled={diffPlan.enabled ? 'true' : 'false'}
          data-merge-diff-exposure={diffPlan.exposure}
          data-merge-diff-initial-tab={diffPlan.initialTab}
          aria-disabled={diffInteractionEnabled ? undefined : 'true'}
        >
          {showBackupCTA ? (
            <button
              type="button"
              className="btn"
              data-testid="merge-dock-backup-cta"
              onClick={() => {
                if (autoSave.flushNow) {
                  autoSave.flushNow()
                  notify('info', 'バックアップを実行しました。')
                } else {
                  notify('error', 'バックアップ操作を利用できません。')
                }
              }}
            >
              バックアップを今すぐ実行
            </button>
          ) : null}
          {diffInteractionEnabled ? (
            <DiffMergeView
              precision={precision}
              hunks={emptyDiffHunks}
              queueMergeCommand={diffMergeNoopCommand}
              autoApplied={phasePlan.autoApplied}
              disabled={!phasePlan.diff.enabled}
            />
          ) : (
            <div
              data-component="diff-merge-view"
              role="note"
              data-testid="merge-diff-disabled-placeholder"
              style={{
                padding: '16px',
                borderRadius: 4,
                border: '1px dashed #cbd5f5',
                background: '#f8fafc',
                color: '#1f2937',
              }}
            >
              Diff マージは現在準備中です。レビュー指標が揃うまでお待ちください。
            </div>
          )}
        </div>
      )}

      {activeTab === 'compiled' && (
        <div>
          <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center' }}>
            <label>統合ルール:</label>
            <select value={preference} onChange={(e) => onPreferenceChange(e.target.value as MergeDockPreference)}>
              <option value="manual-first">Manual優先</option>
              <option value="ai-first">AI優先</option>
              <option
                value="diff-merge"
                disabled={precision === 'stable' && !phasePlan.diff.enabled}
              >
                差分マージ（暫定）
              </option>
            </select>
          </div>
          <pre>{compiledDisplay}</pre>
        </div>
      )}

      {activeTab === 'shot' && (
        <div style={{ padding: 8, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" type="button" onClick={() => downloadText('shotlist.md', toMarkdown(sb))}>
              Export MD
            </button>
            <button className="btn" type="button" onClick={() => downloadText('shotlist.csv', toCSV(sb))}>
              Export CSV
            </button>
            <button className="btn" type="button" onClick={() => downloadText('shotlist.jsonl', toJSONL(sb))}>
              Export JSONL
            </button>
            <button
              className="btn"
              type="button"
              onClick={async () => {
                try {
                  const { directory } = await saveStoryboardSnapshot(sb)
                  notify('info', `Saved snapshot to OPFS: ${directory}`)
                } catch (error) {
                  console.error(error)
                  notify('error', 'Failed to save snapshot to OPFS.')
                }
              }}
            >
              Save Snapshot (OPFS)
            </button>
            <button
              className="btn"
              type="button"
              onClick={async () => {
                try {
                  const snapshot = await loadLatestCompiledSnapshot()
                  if (!snapshot) {
                    notify('error', 'No snapshot available.')
                    return
                  }
                  setCompiledOverride(snapshot.compiled)
                  notify('info', `Restored compiled snapshot from ${snapshot.timestamp}.`)
                } catch (error) {
                  console.error(error)
                  const message =
                    error instanceof MergeDockSnapshotError
                      ? error.message
                      : 'Failed to restore compiled snapshot.'
                  notify('error', message)
                }
              }}
            >
              Restore Last Compiled
            </button>
          </div>
          <pre>{toCSV(sb)}</pre>
        </div>
      )}

      {activeTab === 'assets' && (
        <div style={{ padding: 8 }}>
          <p style={{ margin: '4px 0' }}>登場人物/小道具/背景のカタログ（OPFS保存対応）。</p>
        </div>
      )}

      {activeTab === 'golden' && <GoldenCompare />}

      {activeTab === 'import' && (
        <div style={{ padding: 8, display: 'grid', gap: 8 }}>
          <div>
            <label>Import JSONL/CSV/MD → 反映先: </label>
            <select value={importMode} onChange={(event) => setImportMode(event.target.value as ImportMode)}>
              <option value="manual">manual</option>
              <option value="ai">ai</option>
            </select>
          </div>
          <input
            type="file"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              await onImport(file, importMode)
              event.target.value = ''
            }}
          />
        </div>
      )}
    </div>
  )
}
