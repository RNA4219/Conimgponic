import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  createKeyboardShortcutHandler,
  type ShortcutKeyEvent
} from '../../src/App'
import type { Storyboard } from '../../src/types'

function createStoryboard(): Storyboard {
  return {
    id: 'sb-1',
    title: 'Demo Storyboard',
    scenes: [],
    selection: [],
    version: 1
  }
}

type TestShortcutEvent = ShortcutKeyEvent & { readonly prevented: boolean }

function createShortcutEvent(event: Partial<ShortcutKeyEvent> & { key: string }): TestShortcutEvent {
  const { key, ctrlKey = false, shiftKey = false, altKey = false } = event
  let prevented = false
  const baseEvent: ShortcutKeyEvent = {
    key,
    ctrlKey,
    shiftKey,
    altKey,
    preventDefault() {
      prevented = true
    }
  }
  const withFlag = Object.defineProperty({ ...baseEvent }, 'prevented', {
    get() {
      return prevented
    }
  }) as TestShortcutEvent
  return withFlag
}

test('Ctrl+S と Ctrl+Shift+S が OPFS 非対応エラーを通知する', async () => {
  const storyboard = createStoryboard()
  const alerts: string[] = []
  const logs: unknown[][] = []
  let projectSaves = 0
  let snapshotSaves = 0

  const handler = createKeyboardShortcutHandler({
    getStoryboard: () => storyboard,
    saveProject: async () => {
      projectSaves += 1
      throw new Error('OPFS not supported in this browser')
    },
    saveSnapshot: async () => {
      snapshotSaves += 1
      throw new Error('OPFS not supported in this browser')
    },
    addScene() {
      throw new Error('unexpected addScene call')
    },
    alert(message) {
      alerts.push(message)
    },
    consoleError(...args) {
      logs.push(args)
    }
  })

  const ctrlS = createShortcutEvent({ key: 's', ctrlKey: true })
  await handler(ctrlS)
  await Promise.resolve()

  assert.equal(projectSaves, 1)
  assert.equal(alerts.length, 1)
  assert.match(alerts[0], /OPFS not supported/)
  assert.equal(logs.length, 1)
  assert.equal(logs[0]?.[0], 'Keyboard shortcut handler failed')
  assert.equal(ctrlS.prevented, true)

  const ctrlShiftS = createShortcutEvent({ key: 'S', ctrlKey: true, shiftKey: true })
  await handler(ctrlShiftS)
  await Promise.resolve()

  assert.equal(snapshotSaves, 1)
  assert.equal(alerts.length, 2)
  assert.match(alerts[1], /OPFS not supported/)
  assert.equal(logs.length, 2)
  assert.equal(logs[1]?.[0], 'Keyboard shortcut handler failed')
  assert.equal(ctrlShiftS.prevented, true)
})
