/// <reference types="node" />
import assert from 'node:assert/strict'

const { default: test } = (await import('node:test')) as {
  default: (name: string, fn: () => void) => void
}

import type { Storyboard } from '../../src/types'
import type { AutoSaveInitResult } from '../../src/lib/autosave'
import {
  watchAutoSaveStoryboardDiffs,
  type AutoSaveRunnerRef,
  type AutoSaveStoryboardStore
} from '../../src/App'

test('AS-U-04: App autosave subscription marks runner dirty on storyboard diff', () => {
  const listeners = new Set<(state: { readonly sb: Storyboard }) => void>()
  const initialStoryboard: Storyboard = {
    id: 'sb-test',
    title: '初期ストーリーボード',
    scenes: [],
    selection: [],
    version: 1
  }
  let state = { sb: initialStoryboard } satisfies { sb: Storyboard }

  const store: AutoSaveStoryboardStore = {
    getState: () => state,
    subscribe(listener: (next: { readonly sb: Storyboard }) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }

  const markDirtyPayloads: Array<number | undefined> = []
  const runner: AutoSaveInitResult = {
    snapshot: () => ({ phase: 'idle', retryCount: 0 }),
    async flushNow() {},
    async dispose() {},
    markDirty(meta) {
      markDirtyPayloads.push(meta?.pendingBytes)
    }
  }

  const runnerRef: AutoSaveRunnerRef = { current: runner }
  const unsubscribe = watchAutoSaveStoryboardDiffs(store, runnerRef, runner)

  const notify = (next: Storyboard) => {
    state = { sb: next }
    for (const listener of Array.from(listeners)) {
      listener(state)
    }
  }

  notify(state.sb)
  assert.deepEqual(markDirtyPayloads, [])

  const updated = { ...state.sb, title: '差分検証🚀' }
  notify(updated)

  assert.deepEqual(markDirtyPayloads, [JSON.stringify(updated).length])

  notify(updated)
  assert.deepEqual(markDirtyPayloads, [JSON.stringify(updated).length])

  runnerRef.current = null
  notify({ ...updated, title: 'ランナー切替' })
  assert.deepEqual(markDirtyPayloads, [JSON.stringify(updated).length])

  unsubscribe()
  assert.equal(listeners.size, 0)

  notify({ ...updated, title: '購読解除後' })
  assert.deepEqual(markDirtyPayloads, [JSON.stringify(updated).length])
})
