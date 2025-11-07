import React, { useState, useEffect, useCallback } from 'react'
import type { MergeHunk, MergePrecision } from '../lib/merge'

interface DiffMergeViewProps {
  readonly precision: MergePrecision
  readonly hunks: readonly MergeHunk[]
  readonly queueMergeCommand: (command: any) => Promise<{ status: 'success' | 'partial' | 'error'; hunkIds: string[]; telemetry: any }>
  readonly autoApplied?: { readonly rate: number; readonly target: number; readonly meetsTarget: boolean | null }
  readonly disabled?: boolean
}

interface DiffMergeState {
  selectedHunkId: string | null
}

export const DiffMergeView: React.FC<DiffMergeViewProps> = ({ 
  precision, 
  hunks, 
  queueMergeCommand, 
  autoApplied, 
  disabled = false 
}) => {
  const [state, setState] = useState<DiffMergeState>({ selectedHunkId: null })
  const [loading, setLoading] = useState(false)
  
  const selectHunk = useCallback((id: string) => {
    setState(prev => ({ ...prev, selectedHunkId: id }))
  }, [])
  
  const applyHunkDecision = useCallback(async (hunkId: string, decision: 'manual' | 'ai') => {
    if (disabled) return
    
    setLoading(true)
    try {
      const result = await queueMergeCommand({
        type: 'apply-decision',
        hunkIds: [hunkId],
        decision,
        precision,
        origin: 'diff-merge-view',
        metadata: { autoSaveRequested: true },
        telemetryContext: {
          collectorSurface: 'diff-merge.hunk-list',
          analyzerSurface: 'hunk-decision'
        }
      })
      
      if (result.status === 'error') {
        console.error('Failed to apply hunk decision', result)
      }
    } finally {
      setLoading(false)
    }
  }, [queueMergeCommand, precision, disabled])
  
  // 自動採用率が目標に達しているかを表示
  const autoAppliedDisplay = autoApplied ? (
    <div 
      data-testid="auto-applied-rate" 
      style={{ 
        padding: '4px 8px', 
        borderRadius: '4px',
        background: autoApplied.meetsTarget ? '#dcfce7' : '#fee2e2',
        color: autoApplied.meetsTarget ? '#166534' : '#991b1b'
      }}
    >
      自動採用率: {(autoApplied.rate * 100).toFixed(1)}% ({autoApplied.target * 100}% 目標)
    </div>
  ) : null
  
  return (
    <div 
      data-component="diff-merge-view"
      data-precision={precision}
      data-disabled={disabled}
    >
      {autoAppliedDisplay}
      
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <button
          type="button"
          className="btn"
          disabled={disabled || loading}
          onClick={() => {
            // すべてのハンクを処理するコマンドを実行
            queueMergeCommand({
              type: 'process-all',
              hunkIds: hunks.map(h => h.id),
              precision,
              origin: 'diff-merge-view',
              metadata: { autoSaveRequested: true },
              telemetryContext: {
                collectorSurface: 'diff-merge.bulk-action',
                analyzerSurface: 'bulk-process'
              }
            })
          }}
        >
          すべて処理
        </button>
        
        <button
          type="button"
          className="btn"
          disabled={disabled || loading}
          onClick={() => {
            // 競合のみ処理するコマンドを実行
            const conflictIds = hunks.filter(h => h.decision === 'conflict').map(h => h.id)
            queueMergeCommand({
              type: 'process-conflicts',
              hunkIds: conflictIds,
              precision,
              origin: 'diff-merge-view',
              metadata: { autoSaveRequested: true },
              telemetryContext: {
                collectorSurface: 'diff-merge.bulk-action',
                analyzerSurface: 'conflict-process'
              }
            })
          }}
        >
          競合のみ処理
        </button>
      </div>
      
      <div 
        role="list" 
        aria-label="Merge hunks"
        style={{ display: 'grid', gap: '8px' }}
      >
        {hunks.map((hunk) => (
          <div 
            key={hunk.id}
            role="listitem"
            data-testid={`hunk-${hunk.id}`}
            data-decision={hunk.decision}
            data-selected={state.selectedHunkId === hunk.id}
            style={{
              padding: '8px',
              borderRadius: '4px',
              border: `1px solid ${state.selectedHunkId === hunk.id ? '#3b82f6' : '#e5e7eb'}`,
              background: hunk.decision === 'auto' ? '#f0fdf4' : '#fef2f2',
              cursor: disabled ? 'not-allowed' : 'pointer'
            }}
            onClick={() => !disabled && selectHunk(hunk.id)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{hunk.section || `Section ${hunk.id}`}</strong>
                <span style={{ marginLeft: '8px', fontSize: '0.8em', color: '#6b7280' }}>
                  類似度: {(hunk.similarity * 100).toFixed(1)}%
                </span>
                <span style={{ marginLeft: '8px', fontSize: '0.8em', color: hunk.decision === 'auto' ? '#166534' : '#991b1b' }}>
                  {hunk.decision === 'auto' ? '自動採用' : '競合'}
                </span>
              </div>
              <div>
                <span style={{ fontSize: '0.8em', color: '#6b7280' }}>
                  優先: {hunk.prefer}
                </span>
              </div>
            </div>
            
            {state.selectedHunkId === hunk.id && (
              <div style={{ marginTop: '8px', display: 'grid', gap: '4px' }}>
                <div>
                  <strong>Manual:</strong>
                  <pre style={{ background: '#f3f4f6', padding: '4px', margin: '2px 0' }}>
                    {hunk.manual.substring(0, 200)}{hunk.manual.length > 200 ? '...' : ''}
                  </pre>
                </div>
                <div>
                  <strong>AI:</strong>
                  <pre style={{ background: '#f3f4f6', padding: '4px', margin: '2px 0' }}>
                    {hunk.ai.substring(0, 200)}{hunk.ai.length > 200 ? '...' : ''}
                  </pre>
                </div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={disabled || loading}
                    onClick={(e) => {
                      e.stopPropagation()
                      applyHunkDecision(hunk.id, 'manual')
                    }}
                  >
                    Manualを採用
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={disabled || loading}
                    onClick={(e) => {
                      e.stopPropagation()
                      applyHunkDecision(hunk.id, 'ai')
                    }}
                  >
                    AIを採用
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      
      {hunks.length === 0 && (
        <div 
          data-testid="no-hunks-message"
          style={{ 
            padding: '16px', 
            textAlign: 'center', 
            color: '#6b7280',
            fontStyle: 'italic'
          }}
        >
          マージするセクションがありません
        </div>
      )}
    </div>
  )
}