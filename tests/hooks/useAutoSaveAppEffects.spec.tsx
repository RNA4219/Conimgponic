import { strict as assert } from 'node:assert'
import test from 'node:test'

import { registerAutoSaveShortcuts, publishAutoSaveGuard } from '../../src/hooks/useAutoSaveIntegration'
import type { Storyboard } from '../../src/types'
import type { ToolbarNotifiers } from '../../src/toolbar/handlers'

type Listener = (state: { readonly sb: Storyboard }) => void

type Store = ReturnType<typeof createStore>

function createStore(initial: Storyboard) {
  const listeners = new Set<Listener>()
  let state = initial
  return {
    getState() {
      return { sb: state }
    },
    subscribe(listener: Listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setStoryboard(next: Storyboard) {
      state = next
      for (const listener of listeners) {
        listener({ sb: next })
      }
    }
  }
}

function createStoryboard(): Storyboard {
  return {
    id: 'sb-1',
    title: 'Hook Test',
    scenes: [],
    selection: [],
    version: 1
  }
}

test('registerAutoSaveShortcuts がハンドラ登録とクリーンアップを行う', async () => {
  const store: Store = createStore(createStoryboard())
  const registerCalls: Array<(event: KeyboardEvent) => void> = []
  let unregisterCalls = 0
  const events: KeyboardEvent[] = []
  const notifiers: ToolbarNotifiers = {
    alert() {},
    consoleError() {}
  }

  const unsubscribe = registerAutoSaveShortcuts(
    {
      notifiers,
      saveProject: async () => {},
      saveSnapshot: async () => {},
      addScene() {},
      register(handler) {
        registerCalls.push(handler)
        return () => {
          unregisterCalls += 1
        }
      }
    },
    store,
    (options) => {
      return (event) => {
        events.push(event)
        return options.saveProject(options.getStoryboard())
      }
    }
  )

  assert.equal(registerCalls.length, 1)

  const fakeEvent = {
    key: 's',
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    preventDefault() {}
  } as KeyboardEvent
  await registerCalls[0]?.(fakeEvent)

  assert.equal(events.length, 1)
  assert.equal(events[0], fakeEvent)

  unsubscribe?.()
  assert.equal(unregisterCalls, 1)
})

test('publishAutoSaveGuard が manual-only 決定を通知する', () => {
  const published: Array<Record<string, unknown>> = []
  const originalCollector = (globalThis as { Day8Collector?: { publish?: (payload: unknown) => void } }).Day8Collector
  ;(globalThis as { Day8Collector: { publish: (payload: unknown) => void } }).Day8Collector = {
    publish(payload) {
      published.push(payload as Record<string, unknown>)
    }
  }

  try {
    publishAutoSaveGuard({
      mode: 'manual-only',
      reason: 'options-disabled',
      guard: {
        featureFlag: { value: false, source: 'default' },
        optionsDisabled: true
      }
    })
  } finally {
    if (originalCollector) {
      ;(globalThis as { Day8Collector: typeof originalCollector }).Day8Collector = originalCollector
    } else {
      delete (globalThis as { Day8Collector?: unknown }).Day8Collector
    }
  }

  assert.equal(published.length, 1)
  assert.equal(published[0]?.event, 'autosave.guard')
  assert.equal(published[0]?.blocked, true)
})
