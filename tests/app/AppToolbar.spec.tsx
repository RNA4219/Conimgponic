/// <reference types="node" />

import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  handleToolbarSaveProject,
  handleToolbarLoadProject,
  handleToolbarPackageExport
} from '../../src/App'
import { useSB } from '../../src/store'
import type { Storyboard } from '../../src/types'

function createStoryboard(title: string): Storyboard {
  return {
    ...useSB.getState().sb,
    title,
    scenes: [],
    selection: []
  }
}

test('Save Project ボタンが OPFS 例外を通知し状態を保つ', async () => {
  const storyboard = createStoryboard('Toolbar Save Failure Test')
  const alerts: string[] = []
  const logs: unknown[][] = []
  let persistCalls = 0

  await handleToolbarSaveProject({
    storyboard,
    save: async () => {
      persistCalls += 1
      throw new Error('OPFS quota exceeded')
    },
    alert(message) {
      alerts.push(message)
    },
    consoleError(...args) {
      logs.push(args)
    }
  })

  assert.equal(persistCalls, 1)
  assert.equal(alerts.length, 1)
  assert.match(alerts[0], /OPFS/)
  assert.match(alerts[0], /失敗/)
  assert.equal(logs.length, 1)
  assert.equal(logs[0]?.[0], 'Failed to save project to OPFS')
})

test('Load Project ボタンが OPFS 例外を通知しボードを変更しない', async () => {
  const original = useSB.getState().sb
  useSB.setState({ sb: { ...original, title: 'Load Failure Baseline', scenes: [], selection: [] } })
  const baseline = useSB.getState().sb
  const alerts: string[] = []
  const logs: unknown[][] = []
  let appliedStoryboard: Storyboard | null = null

  await handleToolbarLoadProject({
    load: async () => {
      throw new Error('OPFS not mounted')
    },
    applyStoryboard(value) {
      appliedStoryboard = value
      useSB.setState({ sb: value })
    },
    alert(message) {
      alerts.push(message)
    },
    consoleError(...args) {
      logs.push(args)
    }
  })

  assert.equal(appliedStoryboard, null)
  assert.equal(alerts.length, 1)
  assert.match(alerts[0], /OPFS/)
  assert.match(alerts[0], /失敗/)
  assert.equal(logs.length, 1)
  assert.equal(logs[0]?.[0], 'Failed to load project from OPFS')
  assert.equal(useSB.getState().sb.title, baseline.title)

  useSB.setState({ sb: original })
})

test('Package Export ボタンが OPFS 例外を通知しダウンロードを抑止する', async () => {
  const storyboard = createStoryboard('Package Export Failure Test')
  const alerts: string[] = []
  const logs: unknown[][] = []
  let downloadCalls = 0

  await handleToolbarPackageExport({
    storyboard,
    build: async () => {
      throw new Error('OPFS manifest missing')
    },
    createDownload() {
      downloadCalls += 1
    },
    alert(message) {
      alerts.push(message)
    },
    consoleError(...args) {
      logs.push(args)
    }
  })

  assert.equal(downloadCalls, 0)
  assert.equal(alerts.length, 1)
  assert.match(alerts[0], /失敗/)
  assert.equal(logs.length, 1)
  assert.equal(logs[0]?.[0], 'Failed to export package')
})
