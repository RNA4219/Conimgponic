import assert from 'node:assert/strict'
import test from 'node:test'

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MergeDock } from '../../src/components/MergeDock'
import { resolveMergeDockIntegration } from '../../src/App'
import { resolveAutoSaveBootstrapPlan, type ResolveOptions } from '../../src/config'
import type { MergeDockPhaseStats } from '../../src/components/merge-dock/domain'

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(String(key), String(value))
  }
}

type PhaseStatsInput = { readonly review?: number; readonly conflict?: number }

type WorkspaceMock = Required<ResolveOptions>['workspace']

const REVIEW_KEY = 'merge.phaseStats.reviewBandCount'
const CONFLICT_KEY = 'merge.phaseStats.conflictBandCount'

const createWorkspace = (precision: string, stats?: PhaseStatsInput): WorkspaceMock => ({
  get(key: string): unknown {
    if (key === 'conimg.merge.threshold' || key === 'merge.threshold') {
      return precision
    }
    if (key === REVIEW_KEY || key === `conimg.${REVIEW_KEY}`) {
      return stats?.review
    }
    if (key === CONFLICT_KEY || key === `conimg.${CONFLICT_KEY}`) {
      return stats?.conflict
    }
    return undefined
  }
})

const renderMergeDock = (
  integration: ReturnType<typeof resolveMergeDockIntegration>,
): string => {
  const { phaseStats } = integration as unknown as {
    readonly phaseStats?: MergeDockPhaseStats | null
  }
  return renderToStaticMarkup(
    React.createElement(MergeDock, {
      flags: integration.flagSnapshot,
      mergeThreshold: integration.mergeThreshold,
      workspace: integration.workspace,
      phaseStats: phaseStats ?? null,
    }),
  )
}

test('resolveMergeDockIntegration propagates workspace phase stats to MergeDock gating', () => {
  const originalWindow = (globalThis as { window?: unknown }).window
  const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage

  const storage = new MemoryStorage()
  const mockWindow = {
    localStorage: storage,
    __mergeDockAutoSaveSnapshot: { lastSuccessAt: '2024-05-01T00:00:00.000Z' },
  } as typeof window & {
    __mergeDockAutoSaveSnapshot?: { lastSuccessAt?: string }
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: mockWindow,
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })

  try {
    const workspaceWithoutStats = createWorkspace('beta')
    const planWithoutStats = resolveAutoSaveBootstrapPlan({ workspace: workspaceWithoutStats })
    const integrationWithoutStats = resolveMergeDockIntegration(planWithoutStats, {
      workspace: workspaceWithoutStats,
    })

    const htmlWithoutStats = renderMergeDock(integrationWithoutStats)
    assert.match(htmlWithoutStats, /data-merge-diff-visible="true"/)
    assert.match(htmlWithoutStats, /data-merge-diff-enabled="false"/)

    const workspaceWithStats = createWorkspace('beta', { review: 1, conflict: 0 })
    const planWithStats = resolveAutoSaveBootstrapPlan({ workspace: workspaceWithStats })
    const integrationWithStats = resolveMergeDockIntegration(planWithStats, {
      workspace: workspaceWithStats,
    })

    const htmlWithStats = renderMergeDock(integrationWithStats)
    assert.match(htmlWithStats, /data-merge-diff-visible="true"/)
    assert.match(htmlWithStats, /data-merge-diff-enabled="true"/)

    const { phaseStats } = integrationWithStats as unknown as {
      readonly phaseStats?: MergeDockPhaseStats | null
    }
    assert.deepEqual(phaseStats, { reviewBandCount: 1, conflictBandCount: 0 })
  } finally {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window')
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      })
    }
    if (originalLocalStorage === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage')
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: originalLocalStorage,
      })
    }
  }
})
