import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createFlagSnapshotSubscription,
  notifyFlagSnapshotRefresh,
  resolveMergeDockIntegration
} from '../../src/App'
import { resolveAutoSaveBootstrapPlan } from '../../src/config'

type MutableGlobal = typeof globalThis & {
  window?: Window
  document?: Document
  localStorage?: Storage
}

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

test('App re-evaluates MergeDock integration when flags change live', () => {
  const scope = globalThis as MutableGlobal
  const originalWindow = scope.window
  const originalDocument = scope.document
  const originalLocalStorage = scope.localStorage

  const events = new EventTarget()
  const storage = new MemoryStorage()

  const windowMock = {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    localStorage: storage
  } as unknown as Window

  const documentMock = {
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible'
  } as unknown as Document

  scope.window = windowMock
  scope.document = documentMock
  scope.localStorage = storage

  try {
    const subscription = createFlagSnapshotSubscription(null)

    const snapshots: Array<{
      readonly plan: ReturnType<typeof resolveAutoSaveBootstrapPlan>
      readonly merge: ReturnType<typeof resolveMergeDockIntegration>
    }> = []

    const collect = () => {
      const plan = resolveAutoSaveBootstrapPlan()
      const merge = resolveMergeDockIntegration(plan, null)
      snapshots.push({ plan, merge })
    }

    collect()
    const unsubscribe = subscription.subscribe(() => {
      collect()
    })

    storage.setItem('autosave.enabled', 'true')
    notifyFlagSnapshotRefresh()
    assert.equal(snapshots.at(-1)?.plan.snapshot.autosave.enabled, true)
    assert.equal(snapshots.length, 2)

    storage.setItem('merge.precision', 'beta')
    notifyFlagSnapshotRefresh()
    assert.equal(
      snapshots.at(-1)?.merge.flagSnapshot.merge.precision,
      'beta'
    )
    assert.equal(snapshots.length, 3)

    unsubscribe()
    subscription.dispose()
  } finally {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(scope, 'window')
    } else {
      scope.window = originalWindow
    }

    if (originalDocument === undefined) {
      Reflect.deleteProperty(scope, 'document')
    } else {
      scope.document = originalDocument
    }

    if (originalLocalStorage === undefined) {
      Reflect.deleteProperty(scope, 'localStorage')
    } else {
      scope.localStorage = originalLocalStorage
    }
  }
})
