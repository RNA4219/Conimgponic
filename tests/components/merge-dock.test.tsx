import { describe, it, expect } from 'node:test'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MergeDock } from '../../src/components/MergeDock.js'
import type { FlagSnapshot } from '../../src/config/flags.js'

// MockのFlagSnapshotを定義
const createMockFlagSnapshot = (overrides: Partial<FlagSnapshot> = {}): FlagSnapshot => {
  return {
    autosave: {
      enabled: false,
      source: 'default',
      errors: []
    },
    merge: {
      precision: 'legacy' as const,
      source: 'default',
      errors: []
    },
    updatedAt: new Date().toISOString(),
    ...overrides
  }
}

describe('MergeDock component tests', () => {
  it('should render without diff tab when precision is legacy', () => {
    const mockFlags = createMockFlagSnapshot({ merge: { precision: 'legacy', source: 'default', errors: [] }})
    
    render(<MergeDock 
      flags={mockFlags} 
      autoSaveEnabled={false}
    />)
    
    // Diffタブがレンダリングされていないことを確認
    expect(screen.queryByRole('button', { name: /diff/i })).not.toBeInTheDocument()
  })

  it('should render diff tab when precision is beta', () => {
    const mockFlags = createMockFlagSnapshot({ merge: { precision: 'beta', source: 'env', errors: [] }})
    
    render(<MergeDock 
      flags={mockFlags} 
      autoSaveEnabled={true}
    />)
    
    // Diffタブがレンダリングされていることを確認
    expect(screen.getByRole('button', { name: /diff/i })).toBeInTheDocument()
  })

  it('should render diff tab when precision is stable', () => {
    const mockFlags = createMockFlagSnapshot({ merge: { precision: 'stable', source: 'env', errors: [] }})
    
    render(<MergeDock 
      flags={mockFlags} 
      autoSaveEnabled={true}
    />)
    
    // Diffタブがレンダリングされていることを確認
    expect(screen.getByRole('button', { name: /diff/i })).toBeInTheDocument()
  })

  it('should not render diff tab if autoSave is not enabled in stable mode', () => {
    const mockFlags = createMockFlagSnapshot({ merge: { precision: 'stable', source: 'env', errors: [] }})
    
    render(<MergeDock 
      flags={mockFlags} 
      autoSaveEnabled={false}
    />)
    
    // AutoSaveが無効な場合、Diffタブが表示されないことを確認
    expect(screen.queryByRole('button', { name: /diff/i })).not.toBeInTheDocument()
  })

  it('should switch to diff tab when clicked in beta mode', () => {
    const mockFlags = createMockFlagSnapshot({ merge: { precision: 'beta', source: 'env', errors: [] }})
    
    render(<MergeDock 
      flags={mockFlags} 
      autoSaveEnabled={true}
    />)
    
    const diffTabButton = screen.getByRole('button', { name: /diff/i })
    fireEvent.click(diffTabButton)
    
    // Diffタブがアクティブになっていることを確認
    expect(diffTabButton).toHaveClass('active')
  })

  it('should show placeholder when diff is visible but not enabled', () => {
    const mockFlags = createMockFlagSnapshot({ merge: { precision: 'beta', source: 'default', errors: [] }})
    
    render(<MergeDock 
      flags={mockFlags} 
      autoSaveEnabled={true}
      phaseStats={{ reviewBandCount: 0, conflictBandCount: 0 }} // Stats not sufficient to enable
    />)
    
    // Diffが表示されているが有効ではない場合のプレースホルダーを確認
    expect(screen.getByTestId('merge-diff-disabled-placeholder')).toBeInTheDocument()
  })
})