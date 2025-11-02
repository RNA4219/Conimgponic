import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAutoSaveBootstrapPlan, type ResolveOptions } from '../../src/config'
import { resolveMergeDockIntegration } from '../../src/App'

const WORKSPACE_FLAG_KEY = 'conimg.merge.threshold'

class MemoryStorage implements Storage {
  #store = new Map<string, string>()

  get length(): number {
    return this.#store.size
  }

  clear(): void {
    this.#store.clear()
  }

  getItem(key: string): string | null {
    return this.#store.has(key) ? this.#store.get(key)! : null
  }

  key(index: number): string | null {
    return Array.from(this.#store.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.#store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.#store.set(key, value)
  }
}

const createWorkspace = (precision: string) => ({
  get(key: string): unknown {
    if (key === WORKSPACE_FLAG_KEY || key === 'merge.threshold') {
      return precision
    }
    return undefined
  }
})

test('App passes merge precision workspace override to MergeDock flags', () => {
  const workspace = createWorkspace('beta')
  const options: ResolveOptions = { workspace }
  const plan = resolveAutoSaveBootstrapPlan(options)

  const integration = resolveMergeDockIntegration(plan, options)

  assert.equal(integration.flagSnapshot.merge.precision, 'beta')
  assert.equal(integration.flagSnapshot.merge.source, 'workspace')
  assert.equal(integration.mergeThreshold, plan.snapshot.merge.threshold)
  assert.equal(integration.autoAppliedRate, null)
  assert.equal(integration.workspace, workspace)
})

test('resolveMergeDockIntegration returns MergeDock flag snapshot per rollout spec', () => {
  // docs/IMPLEMENTATION-PLAN.md と docs/design/app-merge-dock-integration.md の統合要件に従い、
  // FlagSnapshot を MergeDock 側でそのまま参照できるようにする。
  const workspace = createWorkspace('stable')
  const options: ResolveOptions = { workspace }
  const plan = resolveAutoSaveBootstrapPlan(options)

  const integration = resolveMergeDockIntegration(plan, options)

  assert.equal(integration.flagSnapshot.merge.precision, plan.snapshot.merge.precision)
  assert.equal(integration.flagSnapshot.merge.threshold, plan.snapshot.merge.threshold)
  assert.equal(integration.autoAppliedRate, null)
})

test('resolveMergeDockIntegration reads collector auto applied rate from storage', () => {
  const scope = globalThis as { localStorage?: Storage }
  const original = scope.localStorage
  const storage = new MemoryStorage()
  scope.localStorage = storage
  storage.setItem('workflow-cookbook:collector:merge_auto_success_rate', '0.77')

  try {
    const plan = resolveAutoSaveBootstrapPlan()
    const integration = resolveMergeDockIntegration(plan, null)

    assert.equal(integration.autoAppliedRate, 0.77)
  } finally {
    if (original) {
      scope.localStorage = original
    } else {
      delete scope.localStorage
    }
  }
})
